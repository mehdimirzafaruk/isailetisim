// Admin oturumu: tek şifre + HMAC imzalı çerez. Giriş denemeleri IP-hash başına sınırlı.
import { parseCookies, ipHash } from './util.js';
import { countLoginAttempts, addLoginAttempt, clearLoginAttempts } from './db.js';

export const SESSION_COOKIE = 'ysess';
const SESSION_MS = 7 * 86400 * 1000;
export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const enc = new TextEncoder();

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Sabit süreli karşılaştırma: iki değerin SHA-256 özetini bayt bayt XOR'lar. */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a ?? ''))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b ?? ''))),
  ]);
  const xa = new Uint8Array(x), ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

// Şifre değişince eski oturumlar da geçersiz olsun diye anahtara şifre karışır.
const signingKey = (env) => `${env.SESSION_SECRET}|${env.ADMIN_PASSWORD}`;

export function authConfigured(env) {
  return !!(env.ADMIN_PASSWORD && env.SESSION_SECRET);
}

export async function createSessionCookie(env, now = Date.now()) {
  const exp = now + SESSION_MS;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(9)));
  const payload = `v1.${exp}.${nonce}`;
  const sig = await hmac(signingKey(env), payload);
  return `${SESSION_COOKIE}=${payload}.${sig}; Max-Age=${SESSION_MS / 1000}; Path=/admin; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/admin; HttpOnly; Secure; SameSite=Lax`;
}

export async function verifySessionValue(env, value, now = Date.now()) {
  if (!value || !authConfigured(env)) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = await hmac(signingKey(env), parts.slice(0, 3).join('.'));
  return safeEqual(expected, parts[3]);
}

export async function isLoggedIn(request, env) {
  const cookies = parseCookies(request.headers.get('cookie'));
  return verifySessionValue(env, cookies[SESSION_COOKIE]);
}

/**
 * Hız sınırlı şifre kontrolü (panel girişi ve kasa kilidi ortak kullanır). Dönen: { ok, status }
 * 10 dakikada 10 deneme (başarılı/başarısız hepsi sayılır); 11.'si 429. Başarıda IP'nin sayacı sıfırlanır.
 */
export async function checkPassword(request, env, password) {
  const ih = await ipHash(request, env);
  const n = await countLoginAttempts(env.DB, ih, Date.now() - LOGIN_WINDOW_MS);
  if (n >= LOGIN_LIMIT) return { ok: false, status: 429 };
  await addLoginAttempt(env.DB, ih);
  if (!(await safeEqual(password, env.ADMIN_PASSWORD))) return { ok: false, status: 401 };
  await clearLoginAttempts(env.DB, ih);
  return { ok: true, status: 302 };
}

/** Giriş denemesi. Dönen: { ok, status, cookie? } */
export async function attemptLogin(request, env, password) {
  const res = await checkPassword(request, env, password);
  if (!res.ok) return res;
  return { ...res, cookie: await createSessionCookie(env) };
}

// ---------------------------------------------------------------- kasa kilidi (ikinci kat)
// 7 günlük panel oturumu şifreler için uzun: /admin/kasa* ayrıca 15 dakikalık "kasa açık" çerezi ister.
// Ömür sabit, istekle uzamaz. Anahtara VAULT_KEY de karışır: anahtar değişince açık kasalar kilitlenir.
export const VAULT_COOKIE = 'yvault';
export const VAULT_MS = 15 * 60 * 1000;
const vaultSigningKey = (env) => `${env.SESSION_SECRET}|${env.ADMIN_PASSWORD}|${env.VAULT_KEY}`;

export async function createVaultCookie(env, now = Date.now()) {
  const exp = now + VAULT_MS;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(9)));
  const payload = `v1.${exp}.${nonce}`;
  const sig = await hmac(vaultSigningKey(env), payload);
  return `${VAULT_COOKIE}=${payload}.${sig}; Max-Age=${VAULT_MS / 1000}; Path=/admin/kasa; HttpOnly; Secure; SameSite=Strict`;
}

export function clearVaultCookie() {
  return `${VAULT_COOKIE}=; Max-Age=0; Path=/admin/kasa; HttpOnly; Secure; SameSite=Strict`;
}

/** Geçerliyse bitiş zamanını (unix ms), değilse false döner. */
export async function verifyVaultValue(env, value, now = Date.now()) {
  if (!value || !authConfigured(env) || !env.VAULT_KEY) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now || exp > now + VAULT_MS) return false;
  const expected = await hmac(vaultSigningKey(env), parts.slice(0, 3).join('.'));
  return (await safeEqual(expected, parts[3])) ? exp : false;
}

/** Kasa açıksa bitiş zamanı (unix ms), kilitliyse false. */
export async function vaultOpenUntil(request, env) {
  const cookies = parseCookies(request.headers.get('cookie'));
  return verifyVaultValue(env, cookies[VAULT_COOKIE]);
}
