import { onlyDigits } from './validators.ts';
import type { Row } from './types.ts';

export function maskValue(keyType: string, value: unknown): string {
  const text = String(value ?? '');
  const digits = onlyDigits(text);
  if (['cpf', 'cnpj'].includes(keyType) && digits.length >= 4) {
    return `***${digits.slice(-4)}`;
  }
  if (keyType === 'placa' && text.length >= 4) {
    return `${text.slice(0, 3)}***${text.slice(-1)}`;
  }
  if (keyType === 'telefone' && digits.length >= 4) {
    return `****${digits.slice(-4)}`;
  }
  if (['renavam', 'chassi'].includes(keyType) && digits.length >= 4) {
    return `***${digits.slice(-4)}`;
  }
  return '***';
}

export function maskCpf(value: unknown): string {
  const digits = onlyDigits(value);
  return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : '***';
}

export function maskCnpj(value: unknown): string {
  const digits = onlyDigits(value);
  return digits.length === 14 ? `**.***.***/${digits.slice(8, 12)}-**` : '***';
}

export function maskPhone(value: unknown): string {
  const digits = onlyDigits(value);
  return digits.length >= 10 ? `(${digits.slice(0, 2)}) ****-${digits.slice(-4)}` : '***';
}

export function maskPlate(value: unknown): string {
  const text = String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return text.length >= 4 ? `${text.slice(0, 3)}***${text.slice(-1)}` : '***';
}

function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return ['cpf', 'cnpj', 'documento', 'renavam', 'chassi', 'telefone', 'celular', 'phone', 'email'].some((part) =>
    lowered.includes(part),
  );
}

export function maskField(key: string, value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const lowered = key.toLowerCase();
  if (lowered.includes('cnpj')) {
    return maskValue('cnpj', text);
  }
  if (lowered.includes('cpf') || lowered.includes('documento')) {
    return text.replace(/[.-]/g, '').length <= 11 ? maskValue('cpf', text) : maskValue('cnpj', text);
  }
  if (lowered.includes('renavam')) {
    return maskValue('renavam', text);
  }
  if (lowered.includes('chassi')) {
    return maskValue('chassi', text);
  }
  if (['telefone', 'phone', 'celular'].some((part) => lowered.includes(part))) {
    return maskValue('telefone', text);
  }
  return '***';
}

export function sanitize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, key));
  }
  if (value !== null && typeof value === 'object') {
    const result: Row = {};
    for (const [itemKey, itemValue] of Object.entries(value as Row)) {
      if (itemValue !== null && typeof itemValue === 'object') {
        result[itemKey] = sanitize(itemValue, itemKey);
      } else if (isSensitiveKey(itemKey) && itemValue !== null && itemValue !== undefined) {
        result[itemKey] = maskField(itemKey, itemValue);
      } else {
        result[itemKey] = itemValue;
      }
    }
    return result;
  }
  return key && isSensitiveKey(key) && value !== null && value !== undefined ? maskField(key, value) : value;
}
