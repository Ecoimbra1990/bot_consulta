import { config } from './env.ts';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }
  const size = Math.max(left.length, right.length);
  let difference = left.length === right.length ? 0 : 1;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

interface EncryptionKey {
  id: string;
  secret: string;
}

async function normalizedSecret(secret: string): Promise<string> {
  try {
    const bytes = fromBase64(secret);
    if (bytes.length === 32) {
      return secret;
    }
  } catch {
    void 0;
  }
  const digest = await subtle.digest('SHA-256', encoder.encode(secret));
  return toBase64(new Uint8Array(digest));
}

async function keys(): Promise<EncryptionKey[]> {
  const configured: EncryptionKey[] = [];
  if (config.encryptionKeys) {
    try {
      const parsed = JSON.parse(config.encryptionKeys) as Array<{ id?: string; secret?: string }>;
      for (const item of parsed) {
        if (item && item.secret) {
          configured.push({ id: String(item.id ?? 'v2'), secret: await normalizedSecret(item.secret) });
        }
      }
    } catch {
      void 0;
    }
  }
  if (configured.length === 0) {
    const fallback = config.fernetKey || config.secretKey;
    configured.push({
      id: 'v2',
      secret: await normalizedSecret(fallback),
    });
  }
  return configured;
}

async function aesKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return subtle.importKey('raw', fromBase64(secret), { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptText(value: string): Promise<string> {
  const available = await keys();
  const current = available[0]!;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(current.secret, 'encrypt'), encoder.encode(value));
  return `v2:${current.id}:${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptText(value: string): Promise<string> {
  try {
    const parts = String(value ?? '').split(':');
    if (parts.length !== 4 || parts[0] !== 'v2') {
      return '';
    }
    const [, keyId, ivPart, payloadPart] = parts as [string, string, string, string];
    const available = await keys();
    const selected = available.find((item) => item.id === keyId);
    if (!selected) {
      return '';
    }
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivPart) },
      await aesKey(selected.secret, 'decrypt'),
      fromBase64(payloadPart),
    );
    return decoder.decode(decrypted);
  } catch {
    return '';
  }
}
