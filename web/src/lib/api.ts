import { supabase } from './supabase';

export interface AdminSuccess<T> {
  ok: true;
  data: T;
}

export interface AdminFailure {
  ok: false;
  error: string;
}

export type AdminEnvelope<T> = AdminSuccess<T> | AdminFailure;

export async function invokeAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action, payload },
  });

  if (error) {
    throw error;
  }

  const response = data as AdminEnvelope<T> | null;

  if (!response) {
    throw new Error('Resposta inválida da API administrativa.');
  }

  if (response.ok === false) {
    throw new Error(response.error || 'Erro na API administrativa.');
  }

  if (response.ok !== true) {
    throw new Error('Resposta inválida da API administrativa.');
  }

  return response.data;
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error) {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message) {
      return message;
    }
  }

  return 'Ocorreu um erro inesperado.';
}
