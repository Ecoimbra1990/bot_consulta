export type CrudValue = string | boolean;
export type CrudValues = Record<string, CrudValue>;

export function toFormText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function toFormBool(value: unknown): boolean {
  return value === true || value === 'true';
}

export function toFormDateTime(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function formText(values: CrudValues, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function formNumber(values: CrudValues, key: string): number | null {
  const text = formText(values, key);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formBool(values: CrudValues, key: string): boolean {
  return values[key] === true || values[key] === 'true';
}
