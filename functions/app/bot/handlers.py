import asyncio
import json

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from app.core.security import decrypt_text, mask_cnpj, mask_cpf, mask_phone
from app.db.repositories import plans_repo, queries_repo, query_results_repo, users_repo
from app.models.types import UserRole, UserStatus
from app.providers.normalize import normalize_vehicle
from app.services.audit import log_action
from app.services.billing import create_checkout
from app.services.dsr import accept_consent, export_user_data, has_consent, request_deletion
from app.services.entitlement import is_entitled
from app.services.queries import run_query
from app.services.validators import (
    is_valid_cnpj,
    is_valid_cpf,
    is_valid_phone,
    is_valid_plate,
    is_valid_renavam,
    normalize_phone,
    normalize_plate,
    only_digits,
)

router = Router()


class Flow(StatesGroup):
    pf_cpf = State()
    vehicle_key = State()
    vehicle_renavam_cpf = State()
    phone = State()
    company_cnpj = State()


def kb_main():
    from aiogram.utils.keyboard import InlineKeyboardBuilder

    kb = InlineKeyboardBuilder()
    kb.button(text="Pessoa Física (CPF)", callback_data="pf:cpf")
    kb.button(text="Veículo (Placa)", callback_data="veh:placa")
    kb.button(text="Veículo (Renavam + CPF)", callback_data="veh:renavam")
    kb.button(text="Veículo (CPF atrelado)", callback_data="veh:cpf")
    kb.button(text="Telefone", callback_data="phone:start")
    kb.button(text="Empresa (CNPJ)", callback_data="company:cnpj")
    kb.button(text="Assinar / Renovar", callback_data="billing:checkout")
    kb.button(text="Minha conta", callback_data="account")
    kb.adjust(1)
    return kb.as_markup()


def kb_consent():
    from aiogram.utils.keyboard import InlineKeyboardBuilder

    kb = InlineKeyboardBuilder()
    kb.button(text="Aceitar termos", callback_data="consent:accept")
    kb.adjust(1)
    return kb.as_markup()


def kb_query(query_id: str):
    from aiogram.utils.keyboard import InlineKeyboardBuilder

    kb = InlineKeyboardBuilder()
    kb.button(text="Detalhes completos", callback_data=f"detail:{query_id}:0")
    kb.button(text="Exportar JSON", callback_data=f"export:{query_id}")
    kb.button(text="Nova consulta", callback_data="home")
    kb.adjust(1)
    return kb.as_markup()


def get_or_create_user(tg_user):
    user = users_repo.by_telegram_id(str(tg_user.id))
    if user:
        if tg_user.username and user.get("username") != tg_user.username:
            users_repo.update(user.id, {"username": tg_user.username})
            user = users_repo.get(user.id)
        return user
    user = users_repo.create(
        {
            "telegram_id": str(tg_user.id),
            "username": tg_user.username,
            "name": tg_user.full_name,
            "role": UserRole.user.value,
            "status": UserStatus.pending.value,
        }
    )
    log_action(actor_user_id=user.id, action="telegram.user.created", target_type="user", target_id=user.id)
    return user


def ensure_access(tg_user) -> tuple[bool, str, object | None]:
    user = users_repo.by_telegram_id(str(tg_user.id))
    if not user:
        return False, "Usuário não cadastrado. Use /start.", None
    if not has_consent(user):
        return False, "É necessário aceitar os termos de privacidade. Use /start.", None
    if not is_entitled(user):
        return False, "Acesso bloqueado: assinatura inativa/inadimplente. Use 'Assinar / Renovar' ou procure o admin.", user
    return True, "", user


@router.message(CommandStart())
async def start(message: Message, state: FSMContext):
    await state.clear()
    user = get_or_create_user(message.from_user)
    if has_consent(user):
        await message.answer("Bot de consultas: PF, veículos, telefone e empresas. Selecione o tipo.", reply_markup=kb_main())
        return
    await message.answer(
        "Para usar o bot é necessário consentir com o tratamento de dados para execução das consultas e cobrança. "
        "Você pode solicitar exportação com /meusdados e exclusão com /excluirmeusdados.",
        reply_markup=kb_consent(),
    )


@router.callback_query(F.data == "consent:accept")
async def consent_accept(cb: CallbackQuery):
    user = get_or_create_user(cb.from_user)
    accept_consent(user.id)
    await cb.message.answer("Consentimento registrado. Selecione o tipo de consulta.", reply_markup=kb_main())
    await cb.answer()


@router.message(Command("meusdados"))
async def my_data(message: Message):
    user = users_repo.by_telegram_id(str(message.from_user.id))
    if not user:
        await message.answer("Usuário não encontrado. Use /start.")
        return
    data = export_user_data(user.id)
    payload = json.dumps(data, ensure_ascii=False, indent=2, default=str)
    await message.answer_document(BufferedInputFile(payload.encode("utf-8"), filename="meus_dados.json"))


@router.message(Command("excluirmeusdados"))
async def delete_my_data(message: Message):
    user = users_repo.by_telegram_id(str(message.from_user.id))
    if not user:
        await message.answer("Usuário não encontrado. Use /start.")
        return
    request_deletion(user.id)
    await message.answer("Solicitação de exclusão registrada. Ela será revisada pelo administrador.")


@router.callback_query(F.data == "home")
async def home(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb.message.answer("Selecione o tipo de consulta:", reply_markup=kb_main())
    await cb.answer()


@router.callback_query(F.data == "account")
async def account(cb: CallbackQuery):
    user = users_repo.by_telegram_id(str(cb.from_user.id))
    if not user:
        await cb.message.answer("Usuário não encontrado.")
        await cb.answer()
        return
    await cb.message.answer(
        f"Conta: {user.get('name') or user.get('username')}\n"
        f"Status: {user.get('status')}\n"
        f"Consentimento: {'sim' if has_consent(user) else 'não'}\n"
        f"Adimplente: {'sim' if is_entitled(user) else 'não'}"
    )
    await cb.answer()


@router.callback_query(F.data == "billing:checkout")
async def billing_checkout(cb: CallbackQuery):
    user = users_repo.by_telegram_id(str(cb.from_user.id))
    if not user or not has_consent(user):
        await cb.message.answer("Aceite os termos com /start antes de assinar.")
        await cb.answer()
        return
    plans = plans_repo.list(filters=[("active", "==", True)], limit=10)
    if not plans:
        await cb.message.answer("Nenhum plano ativo disponível.")
        await cb.answer()
        return
    try:
        checkout = await asyncio.to_thread(create_checkout, user_id=user.id, plan_id=plans[0].id)
    except Exception as exc:
        await cb.message.answer(f"Não foi possível gerar o pagamento: {exc}")
        await cb.answer()
        return
    await cb.message.answer(f"Link de pagamento (válido por 30 min):\n{checkout['checkout_url']}")
    await cb.answer()


@router.callback_query(F.data == "pf:cpf")
async def pf_cpf(cb: CallbackQuery, state: FSMContext):
    ok, msg, _ = ensure_access(cb.from_user)
    if not ok:
        await cb.message.answer(msg)
        await cb.answer()
        return
    await state.set_state(Flow.pf_cpf)
    await cb.message.answer("Informe o CPF (somente números ou formatado):")
    await cb.answer()


@router.callback_query(F.data == "phone:start")
async def phone_start(cb: CallbackQuery, state: FSMContext):
    ok, msg, _ = ensure_access(cb.from_user)
    if not ok:
        await cb.message.answer(msg)
        await cb.answer()
        return
    await state.set_state(Flow.phone)
    await cb.message.answer("Informe o telefone com DDD:")
    await cb.answer()


@router.callback_query(F.data == "company:cnpj")
async def company_start(cb: CallbackQuery, state: FSMContext):
    ok, msg, _ = ensure_access(cb.from_user)
    if not ok:
        await cb.message.answer(msg)
        await cb.answer()
        return
    await state.set_state(Flow.company_cnpj)
    await cb.message.answer("Informe o CNPJ (somente números ou formatado):")
    await cb.answer()


@router.callback_query(F.data.startswith("veh:"))
async def veh_start(cb: CallbackQuery, state: FSMContext):
    ok, msg, _ = ensure_access(cb.from_user)
    if not ok:
        await cb.message.answer(msg)
        await cb.answer()
        return
    key_type = cb.data.split(":", 1)[1]
    await state.set_state(Flow.vehicle_key)
    await state.update_data(vehicle_key_type=key_type)
    label = {"placa": "a placa", "renavam": "o Renavam", "cpf": "o CPF atrelado ao veículo"}.get(key_type, key_type)
    await cb.message.answer(f"Informe {label}:")
    await cb.answer()


@router.message(Flow.pf_cpf)
async def handle_pf_cpf(message: Message, state: FSMContext):
    await state.clear()
    ok, msg, _ = ensure_access(message.from_user)
    if not ok:
        await message.answer(msg)
        return
    cpf = only_digits(message.text or "")
    if not is_valid_cpf(cpf):
        await message.answer("CPF inválido. Tente novamente.")
        return
    await _run_and_reply(message, entity="PF", key_type="cpf", key_value=cpf)


@router.message(Flow.phone)
async def handle_phone(message: Message, state: FSMContext):
    await state.clear()
    ok, msg, _ = ensure_access(message.from_user)
    if not ok:
        await message.answer(msg)
        return
    phone = normalize_phone(message.text or "")
    if not is_valid_phone(phone):
        await message.answer("Telefone inválido. Informe DDD + número.")
        return
    await _run_and_reply(message, entity="TELEFONE", key_type="telefone", key_value=phone)


@router.message(Flow.company_cnpj)
async def handle_company(message: Message, state: FSMContext):
    await state.clear()
    ok, msg, _ = ensure_access(message.from_user)
    if not ok:
        await message.answer(msg)
        return
    cnpj = only_digits(message.text or "")
    if not is_valid_cnpj(cnpj):
        await message.answer("CNPJ inválido. Tente novamente.")
        return
    await _run_and_reply(message, entity="EMPRESA", key_type="cnpj", key_value=cnpj)


@router.message(Flow.vehicle_key)
async def handle_vehicle(message: Message, state: FSMContext):
    data = await state.get_data()
    key_type = data.get("vehicle_key_type", "placa")
    value = (message.text or "").strip()
    if key_type == "renavam":
        renavam = only_digits(value)
        if not is_valid_renavam(renavam):
            await message.answer("Renavam inválido.")
            return
        await state.set_state(Flow.vehicle_renavam_cpf)
        await state.update_data(renavam_value=renavam)
        await message.answer("Renavam recebido. Informe o CPF do proprietário para localizar o veículo na frota:")
        return
    await state.clear()
    ok, msg, _ = ensure_access(message.from_user)
    if not ok:
        await message.answer(msg)
        return
    if key_type == "placa":
        value = normalize_plate(value)
        if not is_valid_plate(value):
            await message.answer("Placa inválida. Use formato ABC1234 ou ABC1D23.")
            return
    elif key_type == "cpf":
        value = only_digits(value)
        if not is_valid_cpf(value):
            await message.answer("CPF inválido.")
            return
    await _run_and_reply(message, entity="VEICULO", key_type=key_type, key_value=value)


@router.message(Flow.vehicle_renavam_cpf)
async def handle_vehicle_renavam_cpf(message: Message, state: FSMContext):
    data = await state.get_data()
    await state.clear()
    ok, msg, _ = ensure_access(message.from_user)
    if not ok:
        await message.answer(msg)
        return
    cpf = only_digits(message.text or "")
    if not is_valid_cpf(cpf):
        await message.answer("CPF inválido. Tente novamente.")
        return
    await _run_and_reply(
        message,
        entity="VEICULO",
        key_type="cpf",
        key_value=cpf,
        renavam_filter=str(data.get("renavam_value") or ""),
    )


async def _run_and_reply(
    message: Message,
    *,
    entity: str,
    key_type: str,
    key_value: str,
    renavam_filter: str | None = None,
):
    user = users_repo.by_telegram_id(str(message.from_user.id))
    if not user:
        await message.answer("Usuário não encontrado.")
        return
    try:
        query = await run_query(user_id=user.id, entity=entity, key_type=key_type, key_value=key_value)
    except (ValueError, PermissionError) as exc:
        await message.answer(str(exc))
        return
    except Exception:
        await message.answer("Erro interno ao processar a consulta.")
        return
    log_action(
        actor_user_id=user.id,
        action="query.executed",
        target_type="query",
        target_id=query.id,
        metadata={"entity": entity, "key_type": key_type, "status": query.status, "provider": query.provider},
    )
    if query.status != "completed":
        await message.answer(f"Consulta falhou: {query.error or 'erro desconhecido'}")
        return
    result = query_results_repo.get(query.id)
    normalized = result.normalized_json if result else {}
    if renavam_filter:
        vehicles = normalized.get("veiculos") or []
        match = next(
            (vehicle for vehicle in vehicles if only_digits(str(vehicle.get("renavam") or "")) == renavam_filter),
            None,
        )
        if not match:
            await message.answer("Renavam não encontrado na frota do CPF informado.")
            return
        normalized = normalize_vehicle("apibrasil", {"data": match}, key_type="renavam", key_value=renavam_filter)
    await message.answer(_summary(normalized), reply_markup=kb_query(query.id))


def _masked_display(value, masker) -> str:
    text = str(value) if value not in (None, "") else "-"
    return text if "*" in text else masker(text)


def _summary(normalized: dict) -> str:
    entity = normalized.get("entity")
    if entity == "PF":
        return (
            f"PF encontrada\nNome: {normalized.get('nome', '-')}\nCPF: {_masked_display(normalized.get('cpf'), mask_cpf)}\n"
            f"Situação: {normalized.get('situacao_cadastral', '-')}\nNascimento: {normalized.get('nascimento', '-')}\n"
            f"Mãe: {normalized.get('nome_mae', '-')}"
        )
    if entity == "EMPRESA":
        return (
            f"Empresa encontrada\nRazão social: {normalized.get('razao_social', '-')}\n"
            f"Nome fantasia: {normalized.get('nome_fantasia', '-')}\nCNPJ: {_masked_display(normalized.get('cnpj'), mask_cnpj)}\n"
            f"Situação: {normalized.get('situacao_cadastral', '-')}\nCNAE: {normalized.get('cnae', '-')}\n"
            f"Endereço: {normalized.get('endereco', '-')}"
        )
    if entity == "TELEFONE":
        return (
            f"Telefone encontrado\nNúmero: {_masked_display(normalized.get('telefone'), mask_phone)}\n"
            f"Titular: {normalized.get('titular', '-')}\nOperadora: {normalized.get('operadora', '-')}\n"
            f"Portabilidade: {normalized.get('portabilidade', '-')}\nLocalização: {normalized.get('localizacao', '-')}"
        )
    if entity == "VEICULO_FROTA":
        vehicles = normalized.get("veiculos") or []
        return f"Frota encontrada\nCPF: {mask_cpf(normalized.get('cpf', ''))}\nVeículos: {len(vehicles)}"
    return (
        f"Veículo encontrado\nPlaca: {normalized.get('placa', '-')}\nRenavam: {normalized.get('renavam', '-')}\n"
        f"Modelo: {normalized.get('marca_modelo', '-')}\nSituação: {normalized.get('situacao', '-')}"
    )


def _can_access_query(cb: CallbackQuery, query) -> bool:
    user = users_repo.by_telegram_id(str(cb.from_user.id))
    if not user:
        return False
    return str(query.get("user_id")) == str(user.id) or user.get("role") == UserRole.admin.value


@router.callback_query(F.data.startswith("detail:"))
async def detail(cb: CallbackQuery):
    _, qid, page = cb.data.split(":")
    page = int(page)
    query = queries_repo.get(qid)
    if not query or not _can_access_query(cb, query):
        await cb.message.answer("Consulta não encontrada.")
        await cb.answer()
        return
    result = query_results_repo.get(qid)
    if not result:
        await cb.message.answer("Consulta não encontrada.")
        await cb.answer()
        return
    raw_text = decrypt_text(result.raw_encrypted_json)
    try:
        payload = json.loads(raw_text) if raw_text else result.normalized_json
    except Exception:
        payload = result.normalized_json
    chunks = _paginate_json(payload, page_size=3000)
    page = max(0, min(page, len(chunks) - 1))
    text = f"Detalhes {page+1}/{len(chunks)}\n```json\n{chunks[page]}\n```"
    from aiogram.utils.keyboard import InlineKeyboardBuilder

    kb = InlineKeyboardBuilder()
    if page > 0:
        kb.button(text="Voltar", callback_data=f"detail:{qid}:{page-1}")
    if page < len(chunks) - 1:
        kb.button(text="Avançar", callback_data=f"detail:{qid}:{page+1}")
    kb.button(text="Exportar JSON", callback_data=f"export:{qid}")
    kb.adjust(2, 1)
    await cb.message.answer(text, parse_mode="Markdown", reply_markup=kb.as_markup())
    await cb.answer()


@router.callback_query(F.data.startswith("export:"))
async def export_json(cb: CallbackQuery):
    qid = cb.data.split(":")[1]
    query = queries_repo.get(qid)
    result = query_results_repo.get(qid)
    if not query or not result or not _can_access_query(cb, query):
        await cb.message.answer("Consulta não encontrada.")
        await cb.answer()
        return
    raw_text = decrypt_text(result.raw_encrypted_json) or json.dumps(result.normalized_json, ensure_ascii=False)
    await cb.message.answer_document(BufferedInputFile(raw_text.encode("utf-8"), filename=f"consulta_{qid}.json"))
    await cb.answer()


def _paginate_json(payload: dict, page_size: int = 3000) -> list[str]:
    pretty = json.dumps(payload, ensure_ascii=False, indent=2)
    return [pretty[i:i + page_size] for i in range(0, len(pretty), page_size)] or ["{}"]
