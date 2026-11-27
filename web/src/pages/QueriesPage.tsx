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

export function QueriesPage() {
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from('queries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (loadError) {
      setError(getErrorMessage(loadError));
    } else {
      setQueries((data ?? []) as Query[]);
    }

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
      charged_cents: toFormText(query.charged_cents),
      module_key: toFormText(query.module_key),
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
          charged_cents: formNumber(editing, 'charged_cents') ?? 0,
          module_key: formText(editing, 'module_key') || null,
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
    { header: 'Módulo', render: (query) => query.module_key ?? '-' },
    { header: 'Custo', render: (query) => formatCurrency(query.cost_cents) },
    { header: 'Cobrado', render: (query) => formatCurrency(query.charged_cents ?? 0) },
    {
      header: 'Erro',
      render: (query) => <span className="max-w-xs truncate text-red-300" title={query.error ?? ''}>{query.error ?? '-'}</span>,
    },
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
