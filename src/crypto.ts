// Passwort-Hashing und Tokens – nur Web Crypto, läuft nativ in Cloudflare Workers.

const ITERATIONS = 100_000; // Obergrenze für PBKDF2 in Workers
const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = await derive(password, fromB64(saltB64), Number(iter));
  return timingSafeEqual(actual, fromB64(hashB64));
}

// Ein Hash, der garantiert nie passt – damit unbekannte Benutzernamen gleich lange brauchen.
export const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function newToken(): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const WORDS = [
  'Eimer', 'Kies', 'Rack', 'Lüfter', 'Redstone', 'Kupfer', 'Server', 'Kühlung',
  'Schacht', 'Turbine', 'Granit', 'Basalt', 'Kabel', 'Pumpe', 'Damm', 'Tresor',
];

function pick(n: number): number {
  const a = crypto.getRandomValues(new Uint32Array(1))[0];
  return a % n;
}

/** Einmal-Passwort wie „Rack-4821-Kies-Pumpe“ – gut vorlesbar, ~41 Bit. */
export function tempPassword(): string {
  const num = String(1000 + pick(9000));
  return `${WORDS[pick(WORDS.length)]}-${num}-${WORDS[pick(WORDS.length)]}-${WORDS[pick(WORDS.length)]}`;
}
