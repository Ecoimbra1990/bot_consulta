import { randomUUID } from 'node:crypto';
import type { QueryOptions, Row, Store } from '../../supabase/functions/_shared/types.ts';

export class MemoryStore implements Store {
  private readonly tables = new Map<string, Map<string, Row>>();

  private table(name: string): Map<string, Row> {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = new Map<string, Row>();
      this.tables.set(name, rows);
    }
    return rows;
  }

  async select(table: string, options: QueryOptions = {}): Promise<Row[]> {
    let rows = Array.from(this.table(table).values());
    for (const [column, value] of Object.entries(options.eq ?? {})) {
      rows = rows.filter((row) => row[column] === value);
    }
    for (const [column, value] of Object.entries(options.is ?? {})) {
      rows = rows.filter((row) => row[column] === value);
    }
    if (options.in) {
      rows = rows.filter((row) => options.in!.values.includes(row[options.in!.column]));
    }
    if (options.order) {
      const { column, ascending = true } = options.order;
      rows.sort((left, right) => {
        const a = String(left[column] ?? '');
        const b = String(right[column] ?? '');
        return ascending ? a.localeCompare(b) : b.localeCompare(a);
      });
    }
    if (options.limit !== undefined) {
      rows = rows.slice(0, options.limit);
    }
    return rows;
  }

  async selectOne(table: string, options: QueryOptions = {}): Promise<Row | null> {
    const rows = await this.select(table, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

  async selectById(table: string, id: string, idColumn = 'id'): Promise<Row | null> {
    return this.selectOne(table, { eq: { [idColumn]: id } });
  }

  async insert(table: string, row: Row): Promise<Row> {
    const saved = { id: randomUUID(), ...row };
    this.table(table).set(String(saved.id), saved);
    return saved;
  }

  async update(table: string, id: string, patch: Row, idColumn = 'id'): Promise<Row | null> {
    const rows = this.table(table);
    for (const [key, row] of rows) {
      if (String(row[idColumn]) === String(id)) {
        const updated = { ...row, ...patch };
        rows.set(key, updated);
        return updated;
      }
    }
    return null;
  }

  async upsert(table: string, row: Row, onConflict = 'id'): Promise<Row> {
    const rows = this.table(table);
    for (const [key, existing] of rows) {
      if (String(existing[onConflict]) === String(row[onConflict])) {
        const updated = { ...existing, ...row };
        rows.set(key, updated);
        return updated;
      }
    }
    return this.insert(table, row);
  }

  async remove(table: string, id: string, idColumn = 'id'): Promise<void> {
    const rows = this.table(table);
    for (const [key, row] of rows) {
      if (String(row[idColumn]) === String(id)) {
        rows.delete(key);
      }
    }
  }

  async removeWhere(table: string, column: string, value: unknown): Promise<void> {
    const rows = this.table(table);
    for (const [key, row] of rows) {
      if (row[column] === value) {
        rows.delete(key);
      }
    }
  }

  async rpc(name: string, args: Row): Promise<any> {
    if (name === 'rate_limit_check') {
      const now = Date.now();
      const id = `${args.p_scope}:${args.p_identity}:${new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
      const rows = this.table('rate_limits');
      const existing = rows.get(id);
      if (existing && existing.expires_at && new Date(existing.expires_at).getTime() < now) {
        rows.delete(id);
      }
      const current = rows.get(id);
      const count = Number(current?.count ?? 0);
      if (count >= Number(args.p_limit)) {
        return false;
      }
      rows.set(id, {
        id,
        scope: args.p_scope,
        identity: args.p_identity,
        count: count + 1,
        expires_at: new Date(now + 120_000).toISOString(),
      });
      return true;
    }

    if (name === 'wallet_credit' || name === 'wallet_debit') {
      const userId = String(args.p_user_id);
      const amount = Math.round(Number(args.p_amount_cents));
      const reference = String(args.p_reference);
      const user = await this.selectById('users', userId);
      if (!user) {
        throw new Error('usuário não encontrado');
      }
      const existing = await this.selectOne('wallet_transactions', { eq: { reference } });
      if (existing) {
        return Number(user.wallet_balance_cents ?? 0);
      }
      const current = Number(user.wallet_balance_cents ?? 0);
      if (name === 'wallet_debit' && current < amount) {
        throw new Error('saldo insuficiente');
      }
      const balance = name === 'wallet_credit' ? current + amount : current - amount;
      await this.update('users', userId, { wallet_balance_cents: balance });
      await this.insert('wallet_transactions', {
        user_id: userId,
        kind: name === 'wallet_credit' ? (args.p_kind ?? 'credit') : 'debit',
        amount_cents: name === 'wallet_credit' ? amount : -amount,
        balance_after_cents: balance,
        reference,
        description: args.p_description ?? null,
        metadata_json: args.p_metadata ?? {},
        created_at: new Date().toISOString(),
      });
      return balance;
    }

    throw new Error(`RPC desconhecida: ${name}`);
  }

  async count(table: string): Promise<number> {
    return this.table(table).size;
  }
}
