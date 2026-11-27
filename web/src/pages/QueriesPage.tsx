import { useEffect, useState } from 'react';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Query } from '../types';

const columns: TableColumn<Query>[] = [
  {
    header: 'ID',
    render: (query) => <span className="font-mono text-xs text-slate-400">{query.id.slice(0, 8)}</span>,
  },
  { header: 'Entidade', render: (query) => query.entity },
  { header: 'Chave', render: (query) => <span className="font-mono">{query.key_masked}</span> },
  { header: 'Tipo', render: (query) => query.key_type },
  {
    header: 'Status',
    render: (query) => (
      <span className={`rounded-full px-2 py-1 text-xs ${
        query.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : query.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'
      }`}>
        {query.status}
      </span>
    ),
  },
  { header: 'Provedor', render: (query) => query.provider ?? '-' },
  { header: 'Custo', render: (query) => formatCurrency(query.cost_cents) },
  {
    header: 'Erro',
    render: (query) => <span className="max-w-xs truncate text-red-300" title={query.error ?? ''}>{query.error ?? '-'}</span>,
  },
  {
    header: 'Criado em',
    render: (query) => <span className="whitespace-nowrap">{formatDateTime(query.created_at)}</span>,
  },
];

export function QueriesPage() {
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from('queries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (!active) {
        return;
      }

      if (loadError) {
        setError(getErrorMessage(loadError));
      } else {
        setQueries((data ?? []) as Query[]);
      }

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Consultas</h1>
        <p className="mt-1 text-sm text-slate-400">Consultas realizadas pelos usuários</p>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <Table columns={columns} rows={queries} rowKey={(query) => query.id} />
      )}
    </div>
  );
}
