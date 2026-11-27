import type { Row, Store } from './types.ts';

export class InsufficientBalanceError extends Error {}

export interface WalletMovementInput {
  userId: string;
  amountCents: number;
  reference: string;
  description: string;
  metadata?: Row;
}

export async function getWalletBalance(store: Store, userId: string): Promise<number> {
  const user = await store.selectById('users', String(userId));
  return Math.max(0, Number.parseInt(String(user?.wallet_balance_cents ?? 0), 10) || 0);
}

export async function creditWallet(store: Store, input: WalletMovementInput, kind = 'credit'): Promise<number> {
  const balance = await store.rpc('wallet_credit', {
    p_user_id: input.userId,
    p_amount_cents: Math.round(input.amountCents),
    p_reference: input.reference,
    p_description: input.description,
    p_metadata: input.metadata ?? {},
    p_kind: kind,
  });
  return Number.parseInt(String(balance), 10) || 0;
}

export async function debitWallet(store: Store, input: WalletMovementInput): Promise<number> {
  try {
    const balance = await store.rpc('wallet_debit', {
      p_user_id: input.userId,
      p_amount_cents: Math.round(input.amountCents),
      p_reference: input.reference,
      p_description: input.description,
      p_metadata: input.metadata ?? {},
    });
    return Number.parseInt(String(balance), 10) || 0;
  } catch (error) {
    if (error instanceof Error && /saldo insuficiente/i.test(error.message)) {
      throw new InsufficientBalanceError('Saldo insuficiente. Use Adicionar PIX para recarregar.');
    }
    throw error;
  }
}

export async function grantWelcomeBonus(store: Store, userId: string, amountCents: number): Promise<number | null> {
  const user = await store.selectById('users', String(userId));
  if (!user) {
    return null;
  }
  return creditWallet(store, {
    userId: String(user.id),
    amountCents,
    reference: `welcome:${user.id}`,
    description: 'Bônus de boas-vindas',
    metadata: { source: 'welcome_bonus' },
  }, 'bonus');
}

export async function walletHistory(store: Store, userId: string, limit = 8): Promise<Row[]> {
  return store.select('wallet_transactions', {
    eq: { user_id: userId },
    order: { column: 'created_at', ascending: false },
    limit,
  });
}
