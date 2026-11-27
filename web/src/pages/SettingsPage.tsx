import { useEffect, useState, type FormEvent } from 'react';
import { getErrorMessage, invokeAdmin } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { AppSettings } from '../types';

const inputClass = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500';
const labelClass = 'mb-2 block text-sm font-medium text-slate-200';

interface SettingsForm {
  query_cache_ttl_seconds: string;
  raw_retention_days: string;
  queries_per_minute: string;
  consent_version: string;
}

const initialForm: SettingsForm = {
  query_cache_ttl_seconds: '',
  raw_retention_days: '',
  queries_per_minute: '',
  consent_version: '',
};

export function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(initialForm);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase.from('app_settings').select('*').eq('id', 'main').maybeSingle();

      if (!active) {
        return;
      }

      if (loadError) {
        setError(getErrorMessage(loadError));
      } else if (!data) {
        setError('Configurações não encontradas.');
      } else {
        const settings = data as AppSettings;

        setForm({
          query_cache_ttl_seconds: String(settings.query_cache_ttl_seconds),
          raw_retention_days: String(settings.raw_retention_days),
          queries_per_minute: String(settings.queries_per_minute),
          consent_version: settings.consent_version,
        });
        setUpdatedAt(settings.updated_at);
      }

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  function setField<K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await invokeAdmin('settings.update', {
        id: 'main',
        query_cache_ttl_seconds: Number(form.query_cache_ttl_seconds),
        raw_retention_days: Number(form.raw_retention_days),
        queries_per_minute: Number(form.queries_per_minute),
        consent_version: form.consent_version.trim(),
      });

      setNotice('Configurações salvas com sucesso.');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="mt-1 text-sm text-slate-400">Parâmetros gerais da aplicação</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : (
        <section className="max-w-2xl rounded-lg border border-slate-800 bg-slate-900 p-5">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className={labelClass} htmlFor="cache-ttl">TTL do cache (segundos)</label>
              <input id="cache-ttl" type="number" min="0" required className={inputClass} value={form.query_cache_ttl_seconds} onChange={(event) => setField('query_cache_ttl_seconds', event.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="retention-days">Retenção de dados brutos (dias)</label>
              <input id="retention-days" type="number" min="0" required className={inputClass} value={form.raw_retention_days} onChange={(event) => setField('raw_retention_days', event.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="rate-limit">Consultas por minuto</label>
              <input id="rate-limit" type="number" min="1" required className={inputClass} value={form.queries_per_minute} onChange={(event) => setField('queries_per_minute', event.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="consent-version">Versão do consentimento</label>
              <input id="consent-version" required className={inputClass} value={form.consent_version} onChange={(event) => setField('consent_version', event.target.value)} />
            </div>

            {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
            {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>}

            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </form>

          {updatedAt && <p className="mt-4 text-xs text-slate-500">Última atualização: {formatDateTime(updatedAt)}</p>}
        </section>
      )}
    </div>
  );
}
