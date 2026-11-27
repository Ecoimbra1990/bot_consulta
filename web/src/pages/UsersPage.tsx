import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog, type CrudField } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formNumber, formText, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { User } from '../types';

const PAGE_SIZE = 50;

const inputClass = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500';
const labelClass = 'mb-2 block text-sm font-medium text-slate-200';

interface NewUserForm {
  name: string;
  telegram_id: string;
  email: string;
  password: string;
  role: User['role'];
  status: User['status'];
}

const initialForm: NewUserForm = {
  name: '',
  telegram_id: '',
  email: '',
  password: '',
  role: 'user',
  status: 'pending',
};

const userFields: CrudField[] = [
  { name: 'name', label: 'Nome' },
  { name: 'telegram_id', label: 'Telegram ID', type: 'number' },
  { name: 'email', label: 'E-mail' },
  {
    name: 'role',
    label: 'Perfil',
    type: 'select',
    options: [
      { value: 'user', label: 'Usuário' },
      { value: 'admin', label: 'Admin' },
    ],
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'pending', label: 'Pendente' },
      { value: 'active', label: 'Ativo' },
      { value: 'blocked', label: 'Bloqueado' },
    ],
  },
];

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<NewUserForm>(initialForm);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const from = page * PAGE_SIZE;
    const { data, count: total, error } = await supabase
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      setLoadError(getErrorMessage(error));
    } else {
      setUsers((data ?? []) as User[]);
      setCount(total ?? 0);
    }

    setLoading(false);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  function setField<K extends keyof NewUserForm>(field: K, value: NewUserForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setActionError(null);

    try {
      const telegramId = form.telegram_id.trim();

      await invokeAdmin('user.create', {
        name: form.name.trim(),
        telegram_id: telegramId ? Number(telegramId) : null,
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        status: form.status,
      });

      setForm(initialForm);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleStatus(user: User, status: User['status']) {
    if (status === user.status) {
      return;
    }

    setUpdatingId(user.id);
    setActionError(null);

    try {
      await invokeAdmin('user.updateStatus', {
        user_id: user.id,
        status,
      });

      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, status } : item)));
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setUpdatingId(null);
    }
  }

  function startEdit(user: User) {
    setActionError(null);
    setEditing({
      id: user.id,
      name: toFormText(user.name),
      telegram_id: toFormText(user.telegram_id),
      email: toFormText(user.email),
      role: user.role,
      status: user.status,
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
    setActionError(null);

    try {
      await invokeAdmin('crud.update', {
        table: 'users',
        id: editing.id,
        patch: {
          name: formText(editing, 'name'),
          telegram_id: formNumber(editing, 'telegram_id'),
          email: formText(editing, 'email').toLowerCase(),
          role: formText(editing, 'role'),
          status: formText(editing, 'status'),
        },
      });
      setEditing(null);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(user: User) {
    if (!window.confirm(`Excluir o usuário ${user.name || user.email}?`)) {
      return;
    }
    setDeletingId(user.id);
    setActionError(null);

    try {
      await invokeAdmin('crud.delete', { table: 'users', id: user.id });
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  const columns: TableColumn<User>[] = [
    {
      header: 'Usuário',
      render: (user) => (
        <div>
          <div className="font-medium text-white">{user.name}</div>
          <div className="text-xs text-slate-400">{user.email}</div>
        </div>
      ),
    },
    { header: 'Telegram', render: (user) => user.telegram_id ?? '-' },
    {
      header: 'Perfil',
      render: (user) => (
        <span className={`rounded-full px-2 py-1 text-xs ${user.role === 'admin' ? 'bg-sky-500/15 text-sky-300' : 'bg-slate-700 text-slate-300'}`}>
          {user.role === 'admin' ? 'Admin' : 'Usuário'}
        </span>
      ),
    },
    {
      header: 'Status',
      render: (user) => (
        <select
          aria-label={`Status de ${user.name}`}
          disabled={updatingId === user.id}
          value={user.status}
          onChange={(event) => void handleStatus(user, event.target.value as User['status'])}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 disabled:opacity-50"
        >
          <option value="pending">Pendente</option>
          <option value="active">Ativo</option>
          <option value="blocked">Bloqueado</option>
        </select>
      ),
    },
    {
      header: 'Criado em',
      render: (user) => <span className="whitespace-nowrap">{formatDateTime(user.created_at)}</span>,
    },
    {
      header: 'Ações',
      render: (user) => (
        <RowActions
          disabled={savingId === user.id || deletingId === user.id}
          onEdit={() => startEdit(user)}
          onDelete={() => void handleDelete(user)}
        />
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Usuários</h1>
        <p className="mt-1 text-sm text-slate-400">Cadastros e situação dos usuários</p>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-white">Novo usuário</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={handleCreate}>
          <div>
            <label className={labelClass} htmlFor="new-user-name">Nome</label>
            <input id="new-user-name" required className={inputClass} value={form.name} onChange={(event) => setField('name', event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-user-telegram">Telegram ID</label>
            <input id="new-user-telegram" type="number" className={inputClass} value={form.telegram_id} onChange={(event) => setField('telegram_id', event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-user-email">E-mail</label>
            <input id="new-user-email" type="email" required className={inputClass} value={form.email} onChange={(event) => setField('email', event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-user-password">Senha</label>
                <input id="new-user-password" type="password" required minLength={12} className={inputClass} value={form.password} onChange={(event) => setField('password', event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-user-role">Perfil</label>
            <select id="new-user-role" className={inputClass} value={form.role} onChange={(event) => setField('role', event.target.value as User['role'])}>
              <option value="user">Usuário</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="new-user-status">Status</label>
            <select id="new-user-status" className={inputClass} value={form.status} onChange={(event) => setField('status', event.target.value as User['status'])}>
              <option value="pending">Pendente</option>
              <option value="active">Ativo</option>
              <option value="blocked">Bloqueado</option>
            </select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Criando...' : 'Criar usuário'}
            </button>
          </div>
        </form>
        {actionError && <p className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{actionError}</p>}
      </section>

      {loadError && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <>
          <Table columns={columns} rows={users} rowKey={(user) => user.id} />
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              Página {page + 1} de {totalPages} · {count} usuários
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                className="rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={(page + 1) * PAGE_SIZE >= count}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}

      {editing && (
        <CrudDialog
          title={`Editar ${editing.name || editing.email}`}
          fields={userFields}
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
