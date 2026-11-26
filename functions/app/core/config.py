
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Bot Consulta"
    app_env: str = "dev"
    secret_key: str = "change-me"
    fernet_key: str | None = None
    fernet_previous_keys: str = ""
    base_url: str = "http://localhost:5001"

    admin_email: str = "admin@example.com"
    admin_password: str = "change-me"

    telegram_bot_token: str | None = None
    telegram_webhook_secret: str = "change-me"

    mercadopago_access_token: str | None = None
    mercadopago_webhook_secret: str | None = None
    mercadopago_api_base: str = "https://api.mercadopago.com"

    apibrasil_token: str | None = None
    apibrasil_base_url: str = "https://gateway.apibrasil.io/api/v2"
    apibrasil_pf_path: str = "/consulta/cpf/credits"
    apibrasil_vehicle_plate_path: str = "/consulta/veiculos/credits"
    apibrasil_vehicle_fleet_path: str = "/consulta/veiculos/credits"
    apibrasil_phone_path: str = "/consulta/cpf-cnpj-pelo-telefone/credits"
    apibrasil_phone_operator_path: str = "/consulta/telefone/credits"
    apibrasil_company_path: str = "/consulta/cnpj/credits"
    apibrasil_mode_mock: bool = False

    consent_version: str = "v1"
    queries_per_minute: int = 10
    query_cache_ttl_seconds: int = 300
    raw_retention_days: int = 90
    firebase_project_id: str | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() in {"prod", "production"}

    def validate_runtime(self) -> None:
        if not self.is_production:
            return
        insecure = [
            name
            for name, value in (
                ("SECRET_KEY", self.secret_key),
                ("ADMIN_PASSWORD", self.admin_password),
                ("TELEGRAM_WEBHOOK_SECRET", self.telegram_webhook_secret),
            )
            if not value or value == "change-me"
        ]
        if insecure:
            raise RuntimeError(f"Segredos obrigatórios não configurados: {', '.join(insecure)}")
        if not self.fernet_key:
            raise RuntimeError("FERNET_KEY é obrigatório em produção")
        if not self.apibrasil_token:
            raise RuntimeError("APIBRASIL_TOKEN é obrigatório em produção")
        if self.apibrasil_mode_mock:
            raise RuntimeError("APIBRASIL_MODE_MOCK não pode ser usado em produção")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls()


settings = Settings.from_env()
