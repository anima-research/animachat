/**
 * Generate a v4 UUID for client-side message IDs.
 *
 * Wraps `crypto.randomUUID()` with fallbacks because that API is gated to
 * "secure contexts" — origins served over HTTPS, plus `localhost`/`127.0.0.1`
 * as special cases. Plain HTTP on a LAN hostname or IP (e.g. accessing a dev
 * server over Tailscale at `http://hostname:5173`) is NOT a secure context,
 * so `crypto.randomUUID` is undefined there and calling it throws synchronously.
 *
 * Fallbacks, in order:
 *   1. `crypto.randomUUID()` when available (modern HTTPS / localhost).
 *   2. `crypto.getRandomValues()` with manual RFC 4122 v4 bit-packing
 *      (available in all browsers, including non-secure contexts).
 *   3. `Math.random()` as a last resort for very locked-down environments.
 */
export function createClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}
