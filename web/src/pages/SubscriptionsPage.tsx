import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CrudDialog, type CrudField } from '../components/CrudDialog';
import { RowActions } from '../components/RowActions';
import { Table, type TableColumn } from '../components/Table';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formBool, formNumber, formText, toFormBool, toFormDateTime, toFormText, type CrudValue, type CrudValues } from '../lib/crud';
import { formatCurrency, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Plan, Subscription, User } from '../types';

const inputClass = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500';
const labelClass = 'mb-2 block text-sm font-medium text-slate-200';

interface ManualForm {
  user_id: string;
  plan_id: string;
  days: string;
  note: string;
}

interface PlanForm {
  name: string;
  price_cents: string;
  period_days: string;
  active: boolean;
}

const initialManualForm: ManualForm = {
  user_id: '',
  plan_id: '',
  days: '30',
  note: '',
};

const initialPlanForm: PlanForm = {
  name: '',
  price_cents: '',
  period_days: '30',
  active: true,
};

const subscriptionFields: CrudField[] = [
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'active', label: 'Ativa' },
      { value: 'past_due', label: 'Em atraso' },
      { value: 'canceled', label: 'Cancelada' },
      { value: 'expired', label: 'Expirada' },
    ],
  },
  { name: 'starts_at', label: 'Início', type: 'datetime-local' },
  { name: 'ends_at', label: 'Fim', type: 'datetime-local' },
  { name: 'external_ref', label: 'Referência externa' },
];

const planFields: CrudField[] = [
  { name: 'name', label: 'Nome' },
  { name: 'price_cents', label: 'Preço (centavos)', type: 'number' },
  { name: 'period_days', label: 'Duração (dias)', type: 'number' },
  { name: 'queries_per_day', label: 'Consultas por dia', type: 'number' },
  { name: 'active', label: 'Plano ativo', type: 'checkbox' },
];

type UserSummary = Pick<User, 'id' | 'name' | 'email'>;

export function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualForm>(initialManualForm);
  const [planForm, setPlanForm] = useState<PlanForm>(initialPlanForm);
  const [activating, setActivating] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<(CrudValues & { id: string }) | null>(null);
  const [editingPlan, setEditingPlan] = useState<(CrudValues & { id: string }) | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [subscriptionsResult, usersResult, plansResult] = await Promise.all([
      supabase.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('users').select('id,name,email'),
      supabase.from('plans').select('*').order('name', { ascending: true }),
    ]);

    const failed = [subscriptionsResult.error, usersResult.error, plansResult.error].find(Boolean);

    if (failed) {
      setLoadError(getErrorMessage(failed));
    } else {
      setSubscriptions((subscriptionsResult.data ?? []) as Subscription[]);
      setUsers((usersResult.data ?? []) as UserSummary[]);
      setPlans((plansResult.data ?? []) as Plan[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function setManualField<K extends keyof ManualForm>(field: K, value: ManualForm[K]) {
    setManualForm((current) => ({ ...current, [field]: value }));
  }

  function setPlanField<K extends keyof PlanForm>(field: K, value: PlanForm[K]) {
    setPlanForm((current) => ({ ...current, [field]: value }));
  }

  async function handleManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActivating(true);
    setActionError(null);

    try {
      await invokeAdmin('subscription.manual', {
        user_id: manualForm.user_id,
        plan_id: manualForm.plan_id,
        days: Number(manualForm.days),
        note: manualForm.note.trim(),
      });

      setManualForm(initialManualForm);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setActivating(false);
    }
  }

  async function handleCreatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingPlan(true);
    setActionError(null);

    try {
      await invokeAdmin('plan.create', {
        name: planForm.name.trim(),
        price_cents: Number(planForm.price_cents),
        period_days: Number(planForm.period_days),
        active: planForm.active,
      });

      setPlanForm(initialPlanForm);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setCreatingPlan(false);
    }
  }

  function startEditSubscription(subscription: Subscription) {
    setActionError(null);
    setEditingSubscription({
      id: subscription.id,
      status: subscription.status,
      starts_at: toFormDateTime(subscription.starts_at),
      ends_at: toFormDateTime(subscription.ends_at),
      external_ref: toFormText(subscription.external_ref),
    });
  }

  function startEditPlan(plan: Plan) {
    setActionError(null);
    setEditingPlan({
      id: plan.id,
      name: toFormText(plan.name),
      price_cents: toFormText(plan.price_cents),
      period_days: toFormText(plan.period_days),
      queries_per_day: toFormText(plan.queries_per_day),
      active: toFormBool(plan.active),
    });
  }

  function setEditSubscriptionField(name: string, value: CrudValue) {
    setEditingSubscription((current) => (current ? { ...current, [name]: value } : current));
  }

  function setEditPlanField(name: string, value: CrudValue) {
    setEditingPlan((current) => (current ? { ...current, [name]: value } : current));
  }

  async function handleUpdateSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSubscription) {
      return;
    }
    setSavingId(editingSubscription.id);
    setActionError(null);

    try {
      await invokeAdmin('crud.update', {
        table: 'subscriptions',
        id: editingSubscription.id,
        patch: {
          status: formText(editingSubscription, 'status'),
          starts_at: formText(editingSubscription, 'starts_at') || null,
          ends_at: formText(editingSubscription, 'ends_at') || null,
          external_ref: formText(editingSubscription, 'external_ref') || null,
        },
      });
      setEditingSubscription(null);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  async function handleUpdatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPlan) {
      return;
    }
    setSavingId(editingPlan.id);
    setActionError(null);

    try {
      await invokeAdmin('crud.update', {
        table: 'plans',
        id: editingPlan.id,
        patch: {
          name: formText(editingPlan, 'name'),
          price_cents: formNumber(editingPlan, 'price_cents'),
          period_days: formNumber(editingPlan, 'period_days'),
          queries_per_day: formNumber(editingPlan, 'queries_per_day'),
          active: formBool(editingPlan, 'active'),
        },
      });
      setEditingPlan(null);
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(table: string, id: string, label: string) {
    if (!window.confirm(`Excluir ${label}?`)) {
      return;
    }
    setDeletingId(id);
    setActionError(null);

    try {
      await invokeAdmin('crud.delete', { table, id });
      await load();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  const emailById = new Map(users.map((user) => [user.id, user.email] as const));
  const nameById = new Map(users.map((user) => [user.id, user.name] as const));
  const planById = new Map(plans.map((plan) => [plan.id, plan] as const));

  const columns: TableColumn<Subscription>[] = [
    {
      header: 'Usuário',
      render: (subscription) => (
        <div>
          <div className="font-medium text-white">{nameById.get(subscription.user_id) ?? subscription.user_id.slice(0, 8)}</div>
          <div className="text-xs text-slate-400">{emailById.get(subscription.user_id) ?? '-'}</div>
        </div>
      ),
    },
    { header: 'Plano', render: (subscription) => planById.get(subscription.plan_id)?.name ?? subscription.plan_id.slice(0, 8) },
    { header: 'Origem', render: (subscription) => subscription.source },
    {
      header: 'Status',
      render: (subscription) => (
        <span className={`rounded-full px-2 py-1 text-xs ${subscription.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
          {subscription.status}
        </span>
      ),
    },
    {
      header: 'Início',
      render: (subscription) => <span className="whitespace-nowrap">{formatDateTime(subscription.starts_at)}</span>,
    },
    {
      header: 'Fim',
      render: (subscription) => <span className="whitespace-nowrap">{formatDateTime(subscription.ends_at)}</span>,
    },
    {
      header: 'Referência',
      render: (subscription) => <span className="font-mono text-xs">{subscription.external_ref ?? '-'}</span>,
    },
    {
      header: 'Ações',
      render: (subscription) => (
        <RowActions
          disabled={savingId === subscription.id || deletingId === subscription.id}
          onEdit={() => startEditSubscription(subscription)}
          onDelete={() => void handleDelete('subscriptions', subscription.id, 'a assinatura')}
        />
      ),
    },
  ];

  const planColumns: TableColumn<Plan>[] = [
    { header: 'Nome', render: (plan) => <span className="font-medium text-white">{plan.name}</span> },
    { header: 'Preço', render: (plan) => formatCurrency(plan.price_cents) },
    { header: 'Duração', render: (plan) => <span className="whitespace-nowrap">{plan.period_days} dias</span> },
    {
      header: 'Ativo',
      render: (plan) => (
        <span className={`rounded-full px-2 py-1 text-xs ${plan.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
          {plan.active ? 'sim' : 'não'}
        </span>
      ),
    },
    {
      header: 'Ações',
      render: (plan) => (
        <RowActions
          disabled={savingId === plan.id || deletingId === plan.id}
          onEdit={() => startEditPlan(plan)}
          onDelete={() => void handleDelete('plans', plan.id, `o plano ${plan.name}`)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Assinaturas</h1>
        <p className="mt-1 text-sm text-slate-400">Assinaturas e planos disponíveis</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-white">Ativar assinatura manual</h2>
          <form className="mt-4 space-y-4" onSubmit={handleManual}>
            <div>
              <label className={labelClass} htmlFor="manual-user">Usuário</label>
              <select id="manual-user" required className={inputClass} value={manualForm.user_id} onChange={(event) => setManualField('user_id', event.target.value)}>
                <option value="">Selecione um usuário</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="manual-plan">Plano</label>
              <select id="manual-plan" required className={inputClass} value={manualForm.plan_id} onChange={(event) => setManualField('plan_id', event.target.value)}>
                <option value="">Selecione um plano</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} - {formatCurrency(plan.price_cents)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="manual-days">Dias</label>
              <input id="manual-days" type="number" min="1" required className={inputClass} value={manualForm.days} onChange={(event) => setManualField('days', event.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="manual-note">Observação</label>
              <input id="manual-note" className={inputClass} value={manualForm.note} onChange={(event) => setManualField('note', event.target.value)} />
            </div>
            <button
              type="submit"
              disabled={activating}
              className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activating ? 'Ativando...' : 'Ativar assinatura'}
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-white">Novo plano</h2>
          <form className="mt-4 space-y-4" onSubmit={handleCreatePlan}>
            <div>
              <label className={labelClass} htmlFor="plan-name">Nome</label>
              <input id="plan-name" required className={inputClass} value={planForm.name} onChange={(event) => setPlanField('name', event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="plan-price">Preço (centavos)</label>
                <input id="plan-price" type="number" min="0" required className={inputClass} value={planForm.price_cents} onChange={(event) => setPlanField('price_cents', event.target.value)} />
              </div>
              <div>
                <label className={labelClass} htmlFor="plan-period">Duração (dias)</label>
                <input id="plan-period" type="number" min="1" required className={inputClass} value={planForm.period_days} onChange={(event) => setPlanField('period_days', event.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={planForm.active} onChange={(event) => setPlanField('active', event.target.checked)} />
              Plano ativo
            </label>
            <button
              type="submit"
              disabled={creatingPlan}
              className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingPlan ? 'Criando...' : 'Criar plano'}
            </button>
          </form>
        </section>
      </div>

      {actionError && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</p>}
      {loadError && <p className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">{loadError}</p>}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Planos</h2>
        {loading ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : (
          <Table columns={planColumns} rows={plans} rowKey={(plan) => plan.id} />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Lista de assinaturas</h2>
        {loading ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : (
          <Table columns={columns} rows={subscriptions} rowKey={(subscription) => subscription.id} />
        )}
      </section>

      {editingSubscription && (
        <CrudDialog
          title="Editar assinatura"
          fields={subscriptionFields}
          values={editingSubscription}
          onChange={setEditSubscriptionField}
          onSubmit={(event) => void handleUpdateSubscription(event)}
          onClose={() => setEditingSubscription(null)}
          saving={savingId === editingSubscription.id}
          error={actionError}
        />
      )}

      {editingPlan && (
        <CrudDialog
          title="Editar plano"
          fields={planFields}
          values={editingPlan}
          onChange={setEditPlanField}
          onSubmit={(event) => void handleUpdatePlan(event)}
          onClose={() => setEditingPlan(null)}
          saving={savingId === editingPlan.id}
          error={actionError}
        />
      )}
    </div>
  );
}
