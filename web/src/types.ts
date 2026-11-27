export interface User {
  id: string;
  legacy_id: number | null;
  telegram_id: number | null;
  username: string | null;
  name: string;
  email: string;
  auth_user_id: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'blocked' | 'pending';
  consent_version: string | null;
  consent_at: string | null;
  anonymized_at: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  price_cents: number;
  period_days: number;
  queries_per_day: number | null;
  active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  source: string;
  status: string;
  starts_at: string;
  ends_at: string;
  external_ref: string | null;
  payment_id: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  plan_id: string;
  subscription_id: string | null;
  provider: string;
  amount_cents: number;
  status: string;
  external_id: string | null;
  external_reference: string | null;
  preference_id: string | null;
  checkout_url: string | null;
  mercadopago_payment_id: string | null;
  expires_at: string | null;
  updated_at: string;
  error: string | null;
  created_at: string;
}

export interface Query {
  id: string;
  user_id: string;
  entity: string;
  key_type: string;
  key_hash: string | null;
  key_masked: string;
  provider: string | null;
  status: 'pending' | 'completed' | 'failed';
  cost_cents: number;
  error: string | null;
  created_at: string;
}

export interface DsrRequest {
  id: string;
  user_id: string;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface AppSettings {
  id: string;
  query_cache_ttl_seconds: number;
  raw_retention_days: number;
  queries_per_minute: number;
  consent_version: string;
  updated_at: string;
}
