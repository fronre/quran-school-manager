/** UUIDv7 (RFC 9562). Pure: the clock and randomness are injected so domain code stays deterministic and testable. */
export function uuidv7(nowMs: number, rand: Uint8Array): string {
  if (rand.length < 10) throw new Error('uuidv7 needs 10 random bytes');
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs >= 2 ** 48) throw new Error('timestamp out of range');
  const b = new Uint8Array(16);
  let t = nowMs;
  for (let i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
  for (let i = 0; i < 10; i++) b[6 + i] = rand[i]!;
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
