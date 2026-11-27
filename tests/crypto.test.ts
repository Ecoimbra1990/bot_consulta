import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptText, encryptText, hmacHex, sha256Hex, timingSafeEqual } from '../supabase/functions/_shared/crypto.ts';

describe('cripto', () => {
  it('cifra e decifra texto no formato v2', async () => {
    const encrypted = await encryptText('dado sensível');
    expect(encrypted.startsWith('v2:v2:')).toBe(true);
    expect(await decryptText(encrypted)).toBe('dado sensível');
    expect(await decryptText(encrypted.replace(/.$/, 'X'))).toBe('');
  });

  it('gera HMAC SHA-256 compatível', async () => {
    const expected = createHmac('sha256', 'segredo').update('mensagem').digest('hex');
    expect(await hmacHex('segredo', 'mensagem')).toBe(expected);
    expect(timingSafeEqual(expected, expected)).toBe(true);
    expect(timingSafeEqual(expected, 'outro')).toBe(false);
  });

  it('gera SHA-256 conhecido', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
