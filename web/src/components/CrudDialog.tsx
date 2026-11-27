import type { FormEvent } from 'react';
import type { CrudValue, CrudValues } from '../lib/crud';

export type CrudFieldType = 'text' | 'number' | 'select' | 'checkbox' | 'datetime-local';

export interface CrudField {
  name: string;
  label: string;
  type?: CrudFieldType;
  options?: Array<{ value: string; label: string }>;
}

interface CrudDialogProps {
  title: string;
  fields: CrudField[];
  values: CrudValues;
  onChange: (name: string, value: CrudValue) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  saving?: boolean;
  error?: string | null;
}

const inputClass = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500';
const labelClass = 'mb-2 block text-sm font-medium text-slate-200';

export function CrudDialog({ title, fields, values, onChange, onSubmit, onClose, saving = false, error }: CrudDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          {fields.map((field) => (
            <div key={field.name} className={field.type === 'checkbox' ? 'sm:col-span-2' : undefined}>
              {field.type === 'checkbox' ? (
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={values[field.name] === true || values[field.name] === 'true'}
                    onChange={(event) => onChange(field.name, event.target.checked)}
                  />
                  {field.label}
                </label>
              ) : (
                <>
                  <label className={labelClass} htmlFor={`crud-${field.name}`}>{field.label}</label>
                  {field.type === 'select' ? (
                    <select
                      id={`crud-${field.name}`}
                      className={inputClass}
                      value={toValue(values[field.name])}
                      onChange={(event) => onChange(field.name, event.target.value)}
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`crud-${field.name}`}
                      type={field.type ?? 'text'}
                      className={inputClass}
                      value={toValue(values[field.name])}
                      onChange={(event) => onChange(field.name, event.target.value)}
                    />
                  )}
                </>
              )}
            </div>
          ))}
          {error && <p className="sm:col-span-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function toValue(value: string | boolean | undefined): string {
  return typeof value === 'string' ? value : value ? 'true' : '';
}
