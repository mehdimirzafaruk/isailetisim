// Herkese açık takip uçları: /i/:code, /api/click, /api/purchase
import { getInfluencer, insertEventDedup, insertEvent, logUnknownHit, purchaseExists } from './db.js';
import { dayOf, parseUA, ipHash, refererDomain, isValidCode, cleanTarget, clip, parseCookies, parseAmount, json, CHANNELS } from './util.js';
import { safeEqual } from './auth.js';
import { detectSource } from './sources.js';

export const REF_COOKIE = 'yref';
/** Sahibinin kendi ziyaretini saymamak için (panel > Ayarlar > Beni sayma). */
export const NOVIEW_COOKIE = 'ynoview';
const VIEW_DEDUP_MS = 30 * 1000;
const REF_MAX_AGE = 30 * 86400;
const VISIT_DEDUP_MS = 30 * 1000;
const CLICK_DEDUP_MS = 5 * 1000;
const MAX_BODY = 4096;

const DEFAULT_PURCHASE_ORIGINS = ['https://www.yasomi.com.tr', 'https://yasomi.com.tr'];

function refCookie(code) {
  return `${REF_COOKIE}=${code}; Max-Age=${REF_MAX_AGE}; Path=/; SameSite=Lax; Secure`;
}

function redirect(location, extraHeaders = {}) {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'strict-origin-when-cross-origin', ...extraHeaders },
  });
}

/** İnfluencer hedefini ref/utm ekleyerek gerçek yönlendirme adresine çevirir. */
export function buildLocation(target, code, origin) {
  target = target || '/';
  if (target.startsWith('/') && !target.startsWith('//')) {
    const u = new URL(target, origin);
    u.searchParams.set('ref', code);
    return u.pathname + u.search + u.hash;
  }
  const u = new URL(target);
  if (/(^|\.)yasomi\.com\.tr$/i.test(u.hostname)) {
    if (!u.searchParams.has('utm_source')) {
      u.searchParams.set('utm_source', 'bio');
      u.searchParams.set('utm_medium', 'influencer');
      u.searchParams.set('utm_campaign', 'isailetisim');
    }
    u.searchParams.set('utm_content', code);
  }
  return u.toString();
}

function requestMeta(request) {
  const ua = request.headers.get('user-agent') || '';
  const { device, browser } = parseUA(ua);
  const cf = request.cf || {};
  return {
    ua: clip(ua, 300),
    device,
    browser,
    country: clip(request.headers.get('cf-ipcountry') || cf.country, 8),
    city: clip(cf.city, 80),
    referer: refererDomain(request.headers.get('referer')),
  };
}

const isExcluded = (request) => parseCookies(request.headers.get('cookie'))[NOVIEW_COOKIE] === '1';

/** /ig, /tt, /fb, /x, /yt, /ln, /wa, /tg -> /?s=<kısa> (görüntüleme bio sayfasında o kaynakla yazılır) */
export function channelRedirect(short) {
  if (!CHANNELS[short]) return null;
  return redirect(`/?s=${short}`);
}

/** Bio sayfası (/) sunulduktan sonra ctx.waitUntil içinde çağrılır: görüntülemeyi yazar. Yanıtı bekletmez. */
export async function pageView(request, env) {
  if (request.method !== 'GET') return false;
  // Tarayıcı ön yüklemesi (prefetch/prerender) insan açılışı değil
  const purpose = (request.headers.get('sec-purpose') || request.headers.get('purpose') || '').toLowerCase();
  if (purpose.includes('prefetch')) return false;
  if (isExcluded(request)) return false;
  const meta = requestMeta(request);
  if (!meta.ua || meta.browser === 'Bot') return false;

  const url = new URL(request.url);
  const rawReferer = request.headers.get('referer');
  let { source, code } = detectSource({ url, referer: rawReferer, browser: meta.browser });
  if (code && !(await getInfluencer(env.DB, code))) ({ source, code } = detectSource({ url, referer: rawReferer, browser: meta.browser, ignoreRef: true }));

  const now = Date.now();
  const ev = {
    ts: now, day: dayOf(now), type: 'view', code, target: source,
    href: clip(url.pathname + url.search, 300), ip_hash: await ipHash(request, env), ...meta,
  };
  // Aynı ip_hash 30 sn içinde tekrar açarsa (yenileme, geri gelme) kaynaktan/koddan bağımsız tek sayılır.
  return insertEventDedup(env.DB, ev, VIEW_DEDUP_MS, { byCode: false });
}

/** GET /i/:code  (ve kod varsa /:code) */
export async function influencerHit(request, env, ctx, code) {
  code = String(code || '').toLowerCase();
  const inf = isValidCode(code) ? await getInfluencer(env.DB, code) : null;
  if (!inf || !inf.active) {
    ctx.waitUntil(logUnknownHit(env.DB, (inf ? 'pasif:' : '') + code).catch((e) => console.error('unknown_hits', e)));
    return redirect('/');
  }
  const origin = new URL(request.url).origin;
  const location = buildLocation(inf.target, code, origin);
  const meta = requestMeta(request);
  if (meta.browser !== 'Bot') {
    const now = Date.now();
    const ev = { ts: now, day: dayOf(now), type: 'visit', code, target: inf.target, href: clip(location, 1000), ip_hash: await ipHash(request, env), ...meta };
    ctx.waitUntil(insertEventDedup(env.DB, ev, VISIT_DEDUP_MS).catch((e) => console.error('visit insert', e)));
  }
  return redirect(location, { 'set-cookie': refCookie(code) });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** Çerez (sunucunun koyduğu) gövdedeki ref'ten önce gelir. Bilinmeyen kod -> null. */
async function resolveRef(env, request, bodyRef) {
  const cookies = parseCookies(request.headers.get('cookie'));
  for (const cand of [cookies[REF_COOKIE], bodyRef]) {
    const c = String(cand || '').toLowerCase().trim();
    if (!isValidCode(c)) continue;
    const inf = await getInfluencer(env.DB, c);
    if (inf) return c;
  }
  return null;
}

/** POST /api/click  {target, ref, href, page_ts} */
export async function click(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, { allow: 'POST' });
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'body' }, 400);
  const meta = requestMeta(request);
  if (meta.browser === 'Bot' || isExcluded(request)) return new Response(null, { status: 204 });

  let href = clip(body.href, 1000);
  let host = null;
  try { const u = new URL(href); if (!/^https?:$/.test(u.protocol)) href = null; else host = u.hostname.replace(/^www\./, ''); } catch { href = null; }
  const target = cleanTarget(body.target) || cleanTarget(host) || 'bilinmiyor';
  const code = await resolveRef(env, request, body.ref);
  const now = Date.now();
  const ev = { ts: now, day: dayOf(now), type: 'click', code, target, href, ip_hash: await ipHash(request, env), ...meta };
  // Beacon yanıtı beklemez; yine de yazmayı isteğe bağla ki test edilebilir olsun.
  await insertEventDedup(env.DB, ev, CLICK_DEDUP_MS);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function purchaseCors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = env.PURCHASE_ORIGINS ? String(env.PURCHASE_ORIGINS).split(',').map((s) => s.trim()) : DEFAULT_PURCHASE_ORIGINS;
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-postback-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export const PURCHASE_SOURCES = ['site', 'trendyol', 'hepsiburada', 'amazon', 'pazarama', 'temu', 'diger'];

/** POST /api/purchase  {ref, order_id, amount, currency, source, note}  + X-Postback-Key */
export async function purchase(request, env) {
  const cors = purchaseCors(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, { allow: 'POST, OPTIONS', ...cors });
  if (!env.PURCHASE_KEY || !(await safeEqual(request.headers.get('x-postback-key') || '', env.PURCHASE_KEY))) {
    return json({ ok: false, error: 'unauthorized' }, 401, cors);
  }
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'body' }, 400, cors);
  const amount = parseAmount(body.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return json({ ok: false, error: 'amount' }, 400, cors);
  const currency = /^[A-Za-z]{3}$/.test(body.currency || '') ? body.currency.toUpperCase() : 'TRY';
  const source = PURCHASE_SOURCES.includes(String(body.source || '').toLowerCase()) ? String(body.source).toLowerCase() : 'site';
  const orderId = clip(body.order_id, 100);
  if (orderId && (await purchaseExists(env.DB, orderId, source))) return json({ ok: true, duplicate: true }, 200, cors);

  const code = await resolveRef(env, request, body.ref);
  const rawRef = clip(body.ref, 60);
  const note = clip([body.note, !code && rawRef ? `ref=${rawRef} (bilinmiyor)` : null].filter(Boolean).join(' · '), 300);
  const now = Date.now();
  const meta = requestMeta(request);
  const id = await insertEvent(env.DB, {
    ts: now, day: dayOf(now), type: 'purchase', code, target: source, amount, currency, order_id: orderId, source, note,
    device: meta.device, browser: meta.browser, ua: meta.ua, country: meta.country, city: meta.city, referer: meta.referer,
    ip_hash: await ipHash(request, env),
  });
  return json({ ok: true, duplicate: false, attributed: !!code, code, id }, 200, cors);
}
