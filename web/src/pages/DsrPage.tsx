import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog, type CrudField } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formText, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { DsrRequest, User } from '../types';

type UserSummary = Pick<User, 'id' | 'name' | 'email'>;

const dsrFields: CrudField[] = [
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'pending', label: 'Pendente' },
      { value: 'done', label: 'Concluída' },
      { value: 'rejected', label: 'Rejeitada' },
    ],
  },
];

export function DsrPage() {
  const [requests, setRequests] = useState<DsrRequest[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [requestsResult, usersResult] = await Promise.all([
      supabase.from('dsr_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('users').select('id,name,email'),
    ]);

    const failed = [requestsResult.error, usersResult.error].find(Boolean);

    if (failed) {
      setLoadError(getErrorMessage(failed));
    } else {
      setRequests((requestsResult.data ?? []) as DsrRequest[]);
      setUsers((usersResult.data ?? []) as UserSummary[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleResolve(request: DsrRequest, approve: boolean) {
    setResolvingId(request.id);
    setActionError(null);

    try {
      await invokeAdmin('dsr.resolve', {
        requestId: request.id,
        approve,
      });

      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setResolvingId(null);
    }
  }

  function startEdit(request: DsrRequest) {
    setActionError(null);
    setEditing({ id: request.id, status: toFormText(request.status) });
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
    setActionError(null);

    try {
      await invokeAdmin('crud.update', {
        table: 'dsr_requests',
        id: editing.id,
        patch: { status: formText(editing, 'status') },
      });
      setEditing(null);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(request: DsrRequest) {
    if (!window.confirm(`Remover a solicitação ${request.id.slice(0, 8)}?`)) {
      return;
    }
    setDeletingId(request.id);
    setActionError(null);

    try {
      await invokeAdmin('crud.delete', { table: 'dsr_requests', id: request.id });
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  const emailById = new Map(users.map((user) => [user.id, user.email] as const));
  const nameById = new Map(users.map((user) => [user.id, user.name] as const));

  const columns: TableColumn<DsrRequest>[] = [
    {
      header: 'ID',
      render: (request) => <span className="font-mono text-xs text-slate-400">{request.id.slice(0, 8)}</span>,
    },
    {
      header: 'Usuário',
      render: (request) => (
        <div>
          <div className="font-medium text-white">{nameById.get(request.user_id) ?? request.user_id.slice(0, 8)}</div>
          <div className="text-xs text-slate-400">{emailById.get(request.user_id) ?? '-'}</div>
        </div>
      ),
    },
    {
      header: 'Solicitado em',
      render: (request) => <span className="whitespace-nowrap">{formatDateTime(request.created_at)}</span>,
    },
    {
      header: 'Ações',
      render: (request) => (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={resolvingId === request.id}
            onClick={() => void handleResolve(request, true)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aprovar exclusão
          </button>
          <button
            type="button"
            disabled={resolvingId === request.id}
            onClick={() => void handleResolve(request, false)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rejeitar
          </button>
        </div>
      ),
    },
    {
      header: 'CRUD',
      render: (request) => (
        <RowActions
          disabled={savingId === request.id || deletingId === request.id || resolvingId === request.id}
          onEdit={() => startEdit(request)}
          onDelete={() => void handleDelete(request)}
          deleteLabel="Remover"
        />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Solicitações DSR</h1>
        <p className="mt-1 text-sm text-slate-400">Pedidos pendentes de exclusão e portabilidade</p>
      </div>

      {actionError && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</p>}
      {loadError && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <Table columns={columns} rows={requests} rowKey={(request) => request.id} empty="Nenhuma solicitação pendente." />
      )}

      {editing && (
        <CrudDialog
          title="Editar solicitação DSR"
          fields={dsrFields}
          values={editing}
          onChange={setEditField}
          onSubmit={(event) => void handleUpdate(event)}
          onClose={() => setEditing(null)}
          saving={savingId === editing.id}
          error={actionError}
        />
      )}
    </div>
  );
}
