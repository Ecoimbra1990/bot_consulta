import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog, type CrudField } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formBool, formNumber, formText, toFormBool, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatCurrency, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { ApiModule, User, WalletTransaction } from '../types';

type ModuleForm = CrudValues & { id: string; isNew?: boolean };

const entityOptions = [
  { value: 'PF', label: 'Pessoa física' },
  { value: 'EMPRESA', label: 'Empresa' },
  { value: 'TELEFONE', label: 'Telefone' },
  { value: 'VEICULO', label: 'Veículo' },
  { value: 'VEICULO_FROTA', label: 'Frota de veículos' },
];

const keyTypeOptions = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'placa', label: 'Placa' },
  { value: 'renavam', label: 'Renavam' },
];

function moduleFields(isNew: boolean): CrudField[] {
  return [
    ...(isNew ? [{ name: 'module_key', label: 'Chave do módulo (ex.: cpf-score)' }] : []),
    { name: 'label', label: 'Nome exibido no Telegram' },
    { name: 'entity', label: 'Entidade', type: 'select', options: entityOptions },
    { name: 'key_type', label: 'Tipo de consulta', type: 'select', options: keyTypeOptions },
    { name: 'mode', label: 'Modalidade', type: 'select', options: [{ value: 'basic', label: 'Básica' }, { value: 'full', label: 'Completa' }] },
    { name: 'source', label: 'Provedor', type: 'select', options: [{ value: 'verifica-online', label: 'Verifica Online' }, { value: 'apibrasil', label: 'APIBrasil' }] },
    { name: 'dataset_key', label: 'Dataset (Verifica Online)' },
    { name: 'service_name', label: 'Serviço (APIBrasil)' },
    { name: 'endpoint', label: 'Endpoint (APIBrasil)' },
    { name: 'cost_cents', label: 'Custo em centavos', type: 'number' },
    { name: 'menu_order', label: 'Ordem no menu', type: 'number' },
    { name: 'active', label: 'Disponível no Telegram', type: 'checkbox' },
  ];
}

type UserSummary = Pick<User, 'id' | 'name' | 'email'>;

export function CatalogPage() {
  const [modules, setModules] = useState<ApiModule[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ModuleForm | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [modulesResult, transactionsResult, usersResult] = await Promise.all([
      supabase.from('api_modules').select('*').order('menu_order', { ascending: true }).limit(200),
      supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('users').select('id,name,email'),
    ]);
    const failed = modulesResult.error ?? transactionsResult.error ?? usersResult.error;
    if (failed) {
      setError(getErrorMessage(failed));
    } else {
      setModules((modulesResult.data ?? []) as ApiModule[]);
      setTransactions((transactionsResult.data ?? []) as WalletTransaction[]);
      setUsers((usersResult.data ?? []) as UserSummary[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setError(null);
    setNotice(null);
    setEditing({
      id: '',
      isNew: true,
      module_key: '',
      label: '',
      entity: 'PF',
      key_type: 'cpf',
      mode: 'basic',
      source: 'verifica-online',
      dataset_key: 'cpf_dados_completos',
      service_name: '',
      endpoint: '',
      cost_cents: '',
      menu_order: '100',
      active: true,
    });
  }

  function startEdit(module: ApiModule) {
    setError(null);
    setNotice(null);
    setEditing({
      id: module.module_key,
      isNew: false,
      label: toFormText(module.label),
      entity: toFormText(module.entity ?? 'PF'),
      key_type: toFormText(module.key_type ?? 'cpf'),
      mode: toFormText(module.mode || 'basic'),
      source: toFormText(module.source || 'apibrasil'),
      dataset_key: toFormText(module.dataset_key),
      service_name: toFormText(module.service_name),
      endpoint: toFormText(module.endpoint),
      cost_cents: toFormText(module.cost_cents),
      menu_order: toFormText(module.menu_order ?? 100),
      active: toFormBool(module.active),
    });
  }

  function setEditField(name: string, value: CrudValue) {
    setEditing((current) => (current ? { ...current, [name]: value } : current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setSavingId(editing.id || formText(editing, 'module_key'));
    setError(null);
    setNotice(null);
    const payload = {
      module_key: formText(editing, 'module_key') || editing.id,
      label: formText(editing, 'label'),
      entity: formText(editing, 'entity'),
      key_type: formText(editing, 'key_type'),
      mode: formText(editing, 'mode'),
      source: formText(editing, 'source'),
      dataset_key: formText(editing, 'dataset_key'),
      service_name: formText(editing, 'service_name'),
      endpoint: formText(editing, 'endpoint'),
      cost_cents: formNumber(editing, 'cost_cents') ?? 0,
      menu_order: formNumber(editing, 'menu_order') ?? 100,
      active: formBool(editing, 'active'),
    };
    try {
      await invokeAdmin(editing.isNew ? 'module.create' : 'module.update', payload);
      setEditing(null);
      setNotice(editing.isNew ? 'Módulo criado e disponível no Telegram.' : 'Módulo atualizado.');
      await load();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(module: ApiModule) {
    setError(null);
    setNotice(null);
    setSavingId(module.module_key);
    try {
      await invokeAdmin('module.delete', { module_key: module.module_key });
      setNotice(`Módulo ${module.label ?? module.module_key} removido.`);
      await load();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setSavingId(null);
    }
  }

  async function handleSync() {
    setError(null);
    setNotice(null);
    setSyncing(true);
    try {
      const result = await invokeAdmin<{ modules: number; alerts: string[] }>('catalog.sync', {});
      setNotice(`Catálogo sincronizado: ${result.modules} módulos.${result.alerts.length ? ` ${result.alerts.join(' ')}` : ''}`);
      await load();
    } catch (syncError) {
      setError(getErrorMessage(syncError));
    } finally {
      setSyncing(false);
    }
  }

  const userNameById = new Map(users.map((user) => [user.id, user.name || user.email] as const));

  const moduleColumns: TableColumn<ApiModule>[] = [
    { header: 'Módulo', render: (module) => <span className="font-medium text-white">{module.label ?? module.module_key}</span> },
    { header: 'Chave', render: (module) => <span className="font-mono text-xs">{module.module_key}</span> },
    {
      header: 'Consulta',
      render: (module) => `${module.entity ?? '-'} / ${module.key_type ?? '-'} / ${module.mode || 'basic'}`,
    },
    { header: 'Origem', render: (module) => module.source },
    { header: 'Dataset', render: (module) => module.dataset_key ?? '-' },
    { header: 'Endpoint', render: (module) => <span className="font-mono text-xs">{module.endpoint ?? '-'}</span> },
    { header: 'Custo', render: (module) => formatCurrency(module.cost_cents) },
    { header: 'Saldo API', render: (module) => (module.balance_cents === null ? '-' : formatCurrency(module.balance_cents)) },
    { header: 'Telegram', render: (module) => (module.active ? 'Ativo' : 'Inativo') },
    { header: 'Atualizado', render: (module) => <span className="whitespace-nowrap">{formatDateTime(module.updated_at)}</span> },
    {
      header: 'Ações',
      render: (module) => (
        <RowActions
          disabled={savingId === module.module_key}
          onEdit={() => startEdit(module)}
          onDelete={() => void handleDelete(module)}
        />
      ),
    },
  ];

  const transactionColumns: TableColumn<WalletTransaction>[] = [
    { header: 'Usuário', render: (item) => userNameById.get(item.user_id) ?? item.user_id.slice(0, 8) },
    { header: 'Tipo', render: (item) => item.kind },
    { header: 'Valor', render: (item) => formatCurrency(item.amount_cents) },
    { header: 'Descrição', render: (item) => item.description ?? '-' },
    { header: 'Data', render: (item) => <span className="whitespace-nowrap">{formatDateTime(item.created_at)}</span> },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Catálogo e carteira</h1>
          <p className="mt-1 text-sm text-slate-400">Módulos disponíveis no Telegram, custos sincronizados e movimentações de créditos</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Novo módulo
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void handleSync()}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar catálogo'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Módulos de consulta</h2>
            <Table columns={moduleColumns} rows={modules} rowKey={(module) => module.module_key} />
          </section>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Movimentações da carteira</h2>
            <Table columns={transactionColumns} rows={transactions} rowKey={(item) => item.id} />
          </section>
        </>
      )}

      {editing && (
        <CrudDialog
          title={editing.isNew ? 'Novo módulo de consulta' : `Editar ${editing.label || editing.id}`}
          fields={moduleFields(Boolean(editing.isNew))}
          values={editing}
          onChange={setEditField}
          onSubmit={(event) => void handleSubmit(event)}
          onClose={() => setEditing(null)}
          saving={savingId === (editing.id || formText(editing, 'module_key'))}
          error={error}
        />
      )}
    </div>
  );
}
