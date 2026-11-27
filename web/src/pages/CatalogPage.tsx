import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog, type CrudField } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formNumber, formText, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatCurrency, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { ApiModule, User, WalletTransaction } from '../types';

const moduleFields: CrudField[] = [
  { name: 'label', label: 'Descrição' },
  { name: 'endpoint', label: 'Endpoint' },
  { name: 'cost_cents', label: 'Custo (centavos)', type: 'number' },
  { name: 'balance_cents', label: 'Saldo API (centavos)', type: 'number' },
];

type UserSummary = Pick<User, 'id' | 'name' | 'email'>;

export function CatalogPage() {
  const [modules, setModules] = useState<ApiModule[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [modulesResult, transactionsResult, usersResult] = await Promise.all([
      supabase.from('api_modules').select('*').order('cost_cents', { ascending: false }).limit(200),
      supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('users').select('id,name,email'),
    ]);
    const failed = modulesResult.error ?? transactionsResult.error ?? usersResult.error;
    if (failed) {
      setError(getErrorMessage(failed));
    } else {
      setModules((modulesResult.data ?? []) as ApiModule[]);
      setTransactions((transactionsResult.data ?? []) as WalletTransaction[]);
      setUsers((usersResult.data ?? []) as UserSummary[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(module: ApiModule) {
    setError(null);
    setEditing({
      id: module.module_key,
      label: toFormText(module.label),
      endpoint: toFormText(module.endpoint),
      cost_cents: toFormText(module.cost_cents),
      balance_cents: toFormText(module.balance_cents),
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
        table: 'api_modules',
        id: editing.id,
        patch: {
          label: formText(editing, 'label') || null,
          endpoint: formText(editing, 'endpoint') || null,
          cost_cents: formNumber(editing, 'cost_cents') ?? 0,
          balance_cents: formNumber(editing, 'balance_cents'),
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

  const userNameById = new Map(users.map((user) => [user.id, user.name || user.email] as const));

  const moduleColumns: TableColumn<ApiModule>[] = [
    { header: 'Módulo', render: (module) => <span className="font-medium text-white">{module.label ?? module.module_key}</span> },
    { header: 'Chave', render: (module) => <span className="font-mono text-xs">{module.module_key}</span> },
    { header: 'Origem', render: (module) => module.source },
    { header: 'Endpoint', render: (module) => <span className="font-mono text-xs">{module.endpoint ?? '-'}</span> },
    { header: 'Custo', render: (module) => formatCurrency(module.cost_cents) },
    { header: 'Saldo API', render: (module) => (module.balance_cents === null ? '-' : formatCurrency(module.balance_cents)) },
    { header: 'Atualizado', render: (module) => <span className="whitespace-nowrap">{formatDateTime(module.updated_at)}</span> },
    {
      header: 'Ações',
      render: (module) => (
        <RowActions disabled={savingId === module.module_key} onEdit={() => startEdit(module)} />
      ),
    },
  ];

  const transactionColumns: TableColumn<WalletTransaction>[] = [
    { header: 'Usuário', render: (item) => userNameById.get(item.user_id) ?? item.user_id.slice(0, 8) },
    { header: 'Tipo', render: (item) => item.kind },
    { header: 'Valor', render: (item) => formatCurrency(item.amount_cents) },
    { header: 'Descrição', render: (item) => item.description ?? '-' },
    { header: 'Data', render: (item) => <span className="whitespace-nowrap">{formatDateTime(item.created_at)}</span> },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Catálogo e carteira</h1>
        <p className="mt-1 text-sm text-slate-400">Custos sincronizados da Verifica Online e da APIBrasil, com movimentações de créditos</p>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Módulos de consulta</h2>
            <Table columns={moduleColumns} rows={modules} rowKey={(module) => module.module_key} />
          </section>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Movimentações da carteira</h2>
            <Table columns={transactionColumns} rows={transactions} rowKey={(item) => item.id} />
          </section>
        </>
      )}

      {editing && (
        <CrudDialog
          title={`Editar ${editing.label || editing.id}`}
          fields={moduleFields}
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
