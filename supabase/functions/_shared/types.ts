export type Row = Record<string, any>;

export interface RuntimeSettings {
  query_cache_ttl_seconds: number;
  raw_retention_days: number;
  queries_per_minute: number;
  consent_version: string;
}

export interface ProviderResult {
  provider: string;
  ok: boolean;
  normalized: Row;
  raw: Row;
  error: string;
  cost_cents: number;
}

export interface QueryOptions {
  eq?: Record<string, unknown>;
  is?: Record<string, null>;
  in?: { column: string; values: unknown[] };
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

export interface Store {
  select(table: string, options?: QueryOptions): Promise<Row[]>;
  selectOne(table: string, options?: QueryOptions): Promise<Row | null>;
  selectById(table: string, id: string, idColumn?: string): Promise<Row | null>;
  insert(table: string, row: Row): Promise<Row>;
  update(table: string, id: string, patch: Row, idColumn?: string): Promise<Row | null>;
  upsert(table: string, row: Row, onConflict?: string): Promise<Row>;
  remove(table: string, id: string, idColumn?: string): Promise<void>;
  removeWhere(table: string, column: string, value: unknown): Promise<void>;
  rpc(name: string, args: Row): Promise<any>;
  count(table: string): Promise<number>;
}
