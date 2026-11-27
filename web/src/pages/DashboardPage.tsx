import { useEffect, useState } from 'react';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/format';
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
];

export function DashboardPage() {
  const [stats, setStats] = useState<Stats>(initialStats);
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const [usersResult, subscriptionsResult, queriesResult, paymentsResult, lastQueriesResult] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('queries').select('*', { count: 'exact', head: true }),
        supabase.from('payments').select('*', { count: 'exact', head: true }),
        supabase.from('queries').select('*').order('created_at', { ascending: false }).limit(20),
      ]);

      if (!active) {
        return;
      }

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
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

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
    </div>
  );
}
