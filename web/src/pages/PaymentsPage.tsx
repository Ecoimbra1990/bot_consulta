import { useEffect, useState } from 'react';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Payment, User } from '../types';

type UserSummary = Pick<User, 'id' | 'name' | 'email'>;

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const [paymentsResult, usersResult] = await Promise.all([
        supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('users').select('id,name,email'),
      ]);

      if (!active) {
        return;
      }

      const failed = [paymentsResult.error, usersResult.error].find(Boolean);

      if (failed) {
        setError(getErrorMessage(failed));
      } else {
        setPayments((paymentsResult.data ?? []) as Payment[]);
        setUsers((usersResult.data ?? []) as UserSummary[]);
      }

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  const emailById = new Map(users.map((user) => [user.id, user.email] as const));
  const nameById = new Map(users.map((user) => [user.id, user.name] as const));

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
        <span className={`rounded-full px-2 py-1 text-xs ${payment.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
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
    </div>
  );
}
