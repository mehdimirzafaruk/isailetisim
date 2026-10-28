// Ortak yardımcılar: zaman (Europe/Istanbul), UA ayrıştırma, hash, doğrulama.

// Türkiye 2016'dan beri kalıcı UTC+3 (yaz saati yok). Sabit ofset Intl'den hızlı ve deterministik.
export const TZ_OFFSET_MS = 3 * 3600 * 1000;
export const DAY_MS = 86400 * 1000;

/** unix ms -> 'YYYY-MM-DD' (İstanbul) */
export function dayOf(ts) {
  return new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Bugünden n gün önceki İstanbul günü (n=0 bugün). */
export function daysAgo(n, now = Date.now()) {
  return dayOf(now - n * DAY_MS);
}

/** unix ms -> 'DD.MM.YYYY HH:MM' (İstanbul) */
export function fmtDateTime(ts) {
  if (!ts) return '';
  const iso = new Date(ts + TZ_OFFSET_MS).toISOString();
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

/** 'YYYY-MM-DD' -> 'DD.MM.YYYY' */
export function fmtDay(day) {
  if (!day) return '';
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

/** 'YYYY-MM-DD' (İstanbul) -> o günün 12:00'si, unix ms */
export function noonOfDay(day) {
  return Date.parse(`${day}T12:00:00+03:00`);
}

export function parseUA(ua) {
  ua = ua || '';
  let device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) device = 'mobile';

  let browser = 'Diğer';
  if (/bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|WhatsApp|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|Pinterest|SkypeUriPreview|preview|Headless|curl|wget|python-requests|Go-http-client|node-fetch|axios|okhttp|undici|Lighthouse|PTST|GTmetrix|Embedly|Iframely|ia_archiver|meta-externalagent/i.test(ua)) browser = 'Bot';
  else if (/Instagram/i.test(ua)) browser = 'Instagram in-app';
  else if (/BytedanceWebview|musical_ly|TikTok|trill_/i.test(ua)) browser = 'TikTok in-app';
  else if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) browser = 'Facebook in-app';
  else if (/Twitter|TwitterAndroid/i.test(ua)) browser = 'X in-app';
  else if (/Snapchat/i.test(ua)) browser = 'Snapchat in-app';
  else if (/Edg(e|A|iOS)?\//i.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/OPR\/|Opera|OPiOS/i.test(ua)) browser = 'Opera';
  else if (/YaBrowser/i.test(ua)) browser = 'Yandex';
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS|Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';
  else if (/iPhone|iPad/i.test(ua) && /AppleWebKit/i.test(ua)) browser = 'iOS WebView';
  return { device, browser };
}

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'local';
}

/** Ham IP saklanmaz: SHA-256(ip + SESSION_SECRET) ilk 16 hex. */
export async function ipHash(request, env) {
  return (await sha256hex(clientIp(request) + '|' + (env.SESSION_SECRET || ''))).slice(0, 16);
}

export function refererDomain(ref) {
  if (!ref) return null;
  try { return new URL(ref).hostname.replace(/^www\./, '').slice(0, 100) || null; } catch { return null; }
}

export const CODE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Bio'ya yapıştırılan kanal kısa linkleri: /ig -> /?s=ig (sources.js etiketleri buradan okur) */
export const CHANNELS = {
  ig: 'instagram', tt: 'tiktok', fb: 'facebook', x: 'x', yt: 'youtube', ln: 'linkedin', wa: 'whatsapp', tg: 'telegram',
  // Tam adlı biçimler (bio'da okunaklı): /instagram, /facebook, /tiktok, /youtube, /twitter, /linkedin, /whatsapp, /telegram
  instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', twitter: 'x', youtube: 'youtube', linkedin: 'linkedin', whatsapp: 'whatsapp', telegram: 'telegram',
};
export const RESERVED_CODES = new Set(['admin', 'api', 'i', 'assets', 'index', 'robots', 'sitemap', 'favicon', 'cname', 'static', 'worker', ...Object.keys(CHANNELS)]);

export function isValidCode(code) {
  return typeof code === 'string' && CODE_RE.test(code) && !RESERVED_CODES.has(code);
}

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
/** "Ayşe Kaya" -> "ayse-kaya" */
export function slugify(s) {
  return String(s || '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] || c)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

/** Hedef: '/' ile başlayan site içi yol (// değil) veya http(s) URL. Geçersizse null. */
export function normalizeTarget(t) {
  t = String(t || '').trim();
  if (!t) return '/';
  if (t.startsWith('#')) t = '/' + t;
  if (t.startsWith('/') && !t.startsWith('//') && !t.includes('\\')) return t.slice(0, 500);
  try {
    const u = new URL(t);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString().slice(0, 1000);
  } catch { /* geçersiz */ }
  return null;
}

/** "5.999" / "5.999,90" / "5999.9" / "5 999 ₺" -> sayı; geçersizse NaN */
export function parseAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').replace(/[\s₺]|TL|TRY/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Hedef/target adı: küçük harf, a-z0-9._- , en çok 64 karakter */
export function cleanTarget(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || null;
}

export function clip(s, n) {
  if (s === undefined || s === null) return null;
  s = String(s);
  return s ? s.slice(0, n) : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// ---------------------------------------------------------------- alan adı
// 28 Ekim 2026: kanonik adres yasomi.net (wrangler.toml [vars] SITE_ORIGIN). Eski alan adı 301 ile buraya gider (/api hariç).
export const DEFAULT_SITE_ORIGIN = 'https://yasomi.net';
/** Eski alan adı: /api/* dışındaki her istek SITE_ORIGIN'e 301 (Ticimax postback'i ve eski beacon'lar hâlâ buraya gelir). */
export const LEGACY_HOSTS = new Set(['isailetisim.com', 'www.isailetisim.com']);

/** Panelde, betiklerde ve linklerde gösterilen kanonik adres: 'https://yasomi.net' (sonda / yok). */
export function siteOrigin(env) {
  const v = String((env && env.SITE_ORIGIN) || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/i.test(v) ? v : DEFAULT_SITE_ORIGIN;
}

/** 'yasomi.net' (şemasız). */
export const siteHost = (env) => siteOrigin(env).replace(/^https?:\/\//i, '');
