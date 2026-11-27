import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { QueryOptions, Row, Store } from './types.ts';

export class SupabaseStore implements Store {
  private readonly client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  private build(table: string, options: QueryOptions = {}) {
    let query = this.client.from(table).select('*');
    for (const [column, value] of Object.entries(options.eq ?? {})) {
      query = query.eq(column, value);
    }
    for (const [column, value] of Object.entries(options.is ?? {})) {
      query = query.is(column, value);
    }
    if (options.in) {
      query = query.in(options.in.column, options.in.values);
    }
    if (options.order) {
      query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
    }
    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }
    return query;
  }

  async select(table: string, options: QueryOptions = {}): Promise<Row[]> {
    const { data, error } = await this.build(table, options);
    if (error) {
      throw new Error(error.message);
    }
    return (data ?? []) as Row[];
  }

  async selectOne(table: string, options: QueryOptions = {}): Promise<Row | null> {
    const { data, error } = await this.build(table, { ...options, limit: 1 });
    if (error) {
      throw new Error(error.message);
    }
    return (data?.[0] as Row) ?? null;
  }

  async selectById(table: string, id: string, idColumn = 'id'): Promise<Row | null> {
    return this.selectOne(table, { eq: { [idColumn]: id } });
  }

  async insert(table: string, row: Row): Promise<Row> {
    const { data, error } = await this.client.from(table).insert(row).select('*').single();
    if (error) {
      throw new Error(error.message);
    }
    return data as Row;
  }

  async update(table: string, id: string, patch: Row, idColumn = 'id'): Promise<Row | null> {
    const { data, error } = await this.client.from(table).update(patch).eq(idColumn, id).select('*').maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return (data as Row) ?? null;
  }

  async upsert(table: string, row: Row, onConflict = 'id'): Promise<Row> {
    const { data, error } = await this.client.from(table).upsert(row, { onConflict }).select('*').single();
    if (error) {
      throw new Error(error.message);
    }
    return data as Row;
  }

  async remove(table: string, id: string, idColumn = 'id'): Promise<void> {
    const { error } = await this.client.from(table).delete().eq(idColumn, id);
    if (error) {
      throw new Error(error.message);
    }
  }

  async removeWhere(table: string, column: string, value: unknown): Promise<void> {
    const { error } = await this.client.from(table).delete().eq(column, value);
    if (error) {
      throw new Error(error.message);
    }
  }

  async rpc(name: string, args: Row): Promise<any> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) {
      throw new Error(error.message);
    }
    return data;
  }

  async count(table: string): Promise<number> {
    const { count, error } = await this.client.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      throw new Error(error.message);
    }
    return count ?? 0;
  }
}

function requireEnv(name: string): string {
  const host = globalThis as typeof globalThis & { Deno?: { env: { get(key: string): string | undefined } }; process?: { env?: Record<string, string | undefined> } };
  const value = host.Deno?.env?.get(name) ?? host.process?.env?.[name];
  if (!value) {
    throw new Error(`${name} não configurado`);
  }
  return value;
}

export function createStore(client?: SupabaseClient): Store {
  return new SupabaseStore(client);
}
