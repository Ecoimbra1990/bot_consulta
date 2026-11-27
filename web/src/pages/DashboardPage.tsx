import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formNumber, formText, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatCurrency, formatDateTime } from '../lib/format';
import { queryFields } from '../lib/query-fields';
import { supabase } from '../lib/supabase';
import type { Query } from '../types';

interface Stats {
  users: number;
  subscriptions: number;
  queries: number;
  payments: number;
}

const initialStats: Stats = {
  users: 0,
  subscriptions: 0,
  queries: 0,
  payments: 0,
};

export function DashboardPage() {
  const [stats, setStats] = useState<Stats>(initialStats);
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [usersResult, subscriptionsResult, queriesResult, paymentsResult, lastQueriesResult] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('queries').select('*', { count: 'exact', head: true }),
      supabase.from('payments').select('*', { count: 'exact', head: true }),
      supabase.from('queries').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    const failed = [usersResult.error, subscriptionsResult.error, queriesResult.error, paymentsResult.error, lastQueriesResult.error].find(Boolean);

    if (failed) {
      setError(getErrorMessage(failed));
      setLoading(false);
      return;
    }

    setStats({
      users: usersResult.count ?? 0,
      subscriptions: subscriptionsResult.count ?? 0,
      queries: queriesResult.count ?? 0,
      payments: paymentsResult.count ?? 0,
    });
    setQueries((lastQueriesResult.data ?? []) as Query[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(query: Query) {
    setError(null);
    setEditing({
      id: query.id,
      entity: query.entity,
      key_type: query.key_type,
      key_masked: toFormText(query.key_masked),
      status: query.status,
      cost_cents: toFormText(query.cost_cents),
      error: toFormText(query.error),
    });
  }

  function setEditField(name: string, value: CrudValue) {
    setEditing((current) => (current ? { ...current, [name]: value } : current));
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setSavingId(editing.id);
    setError(null);

    try {
      await invokeAdmin('crud.update', {
        table: 'queries',
        id: editing.id,
        patch: {
          entity: formText(editing, 'entity'),
          key_type: formText(editing, 'key_type'),
          key_masked: formText(editing, 'key_masked') || null,
          status: formText(editing, 'status'),
          cost_cents: formNumber(editing, 'cost_cents') ?? 0,
          error: formText(editing, 'error') || null,
        },
      });
      setEditing(null);
      await load();
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(query: Query) {
    if (!window.confirm(`Excluir a consulta ${query.id.slice(0, 8)}?`)) {
      return;
    }
    setDeletingId(query.id);
    setError(null);

    try {
      await invokeAdmin('crud.delete', { table: 'queries', id: query.id });
      await load();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  }

  const columns: TableColumn<Query>[] = [
    {
      header: 'ID',
      render: (query) => <span className="font-mono text-xs text-slate-400">{query.id.slice(0, 8)}</span>,
    },
    { header: 'Entidade', render: (query) => query.entity },
    { header: 'Chave', render: (query) => <span className="font-mono">{query.key_masked}</span> },
    { header: 'Tipo', render: (query) => query.key_type },
    { header: 'Status', render: (query) => query.status },
    { header: 'Provedor', render: (query) => query.provider ?? '-' },
    { header: 'Custo', render: (query) => formatCurrency(query.cost_cents) },
    {
      header: 'Criado em',
      render: (query) => <span className="whitespace-nowrap">{formatDateTime(query.created_at)}</span>,
    },
    {
      header: 'Ações',
      render: (query) => (
        <RowActions
          disabled={savingId === query.id || deletingId === query.id}
          onEdit={() => startEdit(query)}
          onDelete={() => void handleDelete(query)}
        />
      ),
    },
  ];

  const cards = [
    { label: 'Usuários', value: stats.users },
    { label: 'Assinaturas ativas', value: stats.subscriptions },
    { label: 'Consultas', value: stats.queries },
    { label: 'Pagamentos', value: stats.payments },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Visão geral da operação</p>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-white">{loading ? '...' : card.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Últimas consultas</h2>
        <Table columns={columns} rows={queries} rowKey={(query) => query.id} />
      </section>

      {editing && (
        <CrudDialog
          title="Editar consulta"
          fields={queryFields}
          values={editing}
          onChange={setEditField}
          onSubmit={(event) => void handleUpdate(event)}
          onClose={() => setEditing(null)}
          saving={savingId === editing.id}
          error={error}
        />
      )}
    </div>
  );
}
