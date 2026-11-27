import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog, type CrudField } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formNumber, formText, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatCurrency, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Payment, User } from '../types';

type UserSummary = Pick<User, 'id' | 'name' | 'email'>;

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [paymentsResult, usersResult] = await Promise.all([
      supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('users').select('id,name,email'),
    ]);

    const failed = [paymentsResult.error, usersResult.error].find(Boolean);

    if (failed) {
      setError(getErrorMessage(failed));
    } else {
      setPayments((paymentsResult.data ?? []) as Payment[]);
      setUsers((usersResult.data ?? []) as UserSummary[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const emailById = new Map(users.map((user) => [user.id, user.email] as const));
  const nameById = new Map(users.map((user) => [user.id, user.name] as const));

  const paymentFields: CrudField[] = [
    {
      name: 'user_id',
      label: 'Usuário',
      type: 'select',
      options: [
        { value: '', label: 'Sem usuário' },
        ...users.map((user) => ({ value: user.id, label: `${user.name} (${user.email})` })),
      ],
    },
    { name: 'amount_cents', label: 'Valor (centavos)', type: 'number' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'pending', label: 'Pendente' },
        { value: 'paid', label: 'Pago' },
        { value: 'failed', label: 'Falhou' },
        { value: 'manual', label: 'Manual' },
      ],
    },
    { name: 'external_id', label: 'ID externo' },
    { name: 'external_reference', label: 'Referência externa' },
    { name: 'checkout_url', label: 'URL do checkout' },
    { name: 'error', label: 'Erro' },
  ];

  function startEdit(payment: Payment) {
    setError(null);
    setEditing({
      id: payment.id,
      user_id: toFormText(payment.user_id),
      amount_cents: toFormText(payment.amount_cents),
      status: payment.status,
      external_id: toFormText(payment.external_id),
      external_reference: toFormText(payment.external_reference),
      checkout_url: toFormText(payment.checkout_url),
      error: toFormText(payment.error),
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
        table: 'payments',
        id: editing.id,
        patch: {
          user_id: formText(editing, 'user_id') || null,
          amount_cents: formNumber(editing, 'amount_cents') ?? 0,
          status: formText(editing, 'status'),
          external_id: formText(editing, 'external_id') || null,
          external_reference: formText(editing, 'external_reference') || null,
          checkout_url: formText(editing, 'checkout_url') || null,
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

  async function handleDelete(payment: Payment) {
    if (!window.confirm(`Excluir o pagamento ${payment.id.slice(0, 8)}?`)) {
      return;
    }
    setDeletingId(payment.id);
    setError(null);

    try {
      await invokeAdmin('crud.delete', { table: 'payments', id: payment.id });
      await load();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  }

  const columns: TableColumn<Payment>[] = [
    {
      header: 'ID',
      render: (payment) => <span className="font-mono text-xs text-slate-400">{payment.id.slice(0, 8)}</span>,
    },
    {
      header: 'Usuário',
      render: (payment) => (
        <div>
          <div className="font-medium text-white">{nameById.get(payment.user_id) ?? payment.user_id.slice(0, 8)}</div>
          <div className="text-xs text-slate-400">{emailById.get(payment.user_id) ?? '-'}</div>
        </div>
      ),
    },
    { header: 'Valor', render: (payment) => <span className="whitespace-nowrap">{formatCurrency(payment.amount_cents)}</span> },
    {
      header: 'Status',
      render: (payment) => (
        <span className={`rounded-full px-2 py-1 text-xs ${payment.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
          {payment.status}
        </span>
      ),
    },
    {
      header: 'ID externo',
      render: (payment) => <span className="font-mono text-xs">{payment.external_id ?? '-'}</span>,
    },
    {
      header: 'Criado em',
      render: (payment) => <span className="whitespace-nowrap">{formatDateTime(payment.created_at)}</span>,
    },
    {
      header: 'Ações',
      render: (payment) => (
        <RowActions
          disabled={savingId === payment.id || deletingId === payment.id}
          onEdit={() => startEdit(payment)}
          onDelete={() => void handleDelete(payment)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Pagamentos</h1>
        <p className="mt-1 text-sm text-slate-400">Histórico de pagamentos recebidos</p>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <Table columns={columns} rows={payments} rowKey={(payment) => payment.id} />
      )}

      {editing && (
        <CrudDialog
          title="Editar pagamento"
          fields={paymentFields}
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
