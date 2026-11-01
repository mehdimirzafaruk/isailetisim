// /m/* : sosyal medya yayını için imzalı, süreli, herkese açık video linkleri (R2).
// Meta (Instagram video_url) ve TikTok PULL_FROM_URL herkese açık HTTPS ister; sunucu videoyu buraya yükler,
// platform imzalı linkten çeker, yayın bitince sunucu siler.
//
//   PUT    /m/upload/<sha256>.mp4      Authorization: Bearer <MEDIA_UPLOAD_SECRET>  gövde = video (sha256 doğrulanır)
//   GET    /m/<sha256>.mp4?exp=&sig=   herkese açık, 24 saat geçerli HMAC imzası, Range destekli
//   HEAD   /m/<sha256>.mp4?exp=&sig=
//   DELETE /m/<sha256>.mp4             Authorization: Bearer <MEDIA_UPLOAD_SECRET>
//
// Bağlantılar: env.PUBLISH_MEDIA (R2 bucket), env.MEDIA_UPLOAD_SECRET (wrangler secret). Biri yoksa 503.

export const MEDIA_TTL_S = 24 * 3600;
export const MEDIA_MAX_BYTES = 95 * 1024 * 1024; // Workers istek gövdesi sınırının altında
const enc = new TextEncoder();
const KEY_PREFIX = 'publish/';

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function timingSafeEqualHex(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signMedia(secret, sha, exp) {
  return hmacHex(secret, `m:${sha}:${exp}`);
}

export async function verifyMediaSig(secret, sha, exp, sig, nowS = Math.floor(Date.now() / 1000)) {
  const e = Number(exp);
  if (!Number.isInteger(e) || e < nowS || e > nowS + MEDIA_TTL_S + 300) return false;
  return timingSafeEqualHex(await signMedia(secret, sha, e), sig);
}

/** 'bytes=a-b' | 'bytes=a-' | 'bytes=-n' -> {offset,length} | null (yok) | 'invalid' */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start, end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return 'invalid';
  return { offset: start, length: end - start + 1 };
}

function text(body, status, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

async function authorized(request, env) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return false;
  // Uzunluk sızmasın diye iki tarafın özeti karşılaştırılır.
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(token)), crypto.subtle.digest('SHA-256', enc.encode(env.MEDIA_UPLOAD_SECRET))]);
  return timingSafeEqualHex(hex(a), hex(b));
}

export async function handleMedia(request, env, url) {
  const bucket = env.PUBLISH_MEDIA;
  const secret = env.MEDIA_UPLOAD_SECRET;
  if (!bucket || !secret) return text('Medya servisi kapalı', 503);
  const p = url.pathname;

  const up = p.match(/^\/m\/upload\/([a-f0-9]{64})\.mp4$/);
  if (up) {
    if (request.method !== 'PUT') return text('Method Not Allowed', 405, { allow: 'PUT' });
    if (!(await authorized(request, env))) return text('Yetkisiz', 401);
    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > MEDIA_MAX_BYTES) return text('Çok büyük', 413);
    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MEDIA_MAX_BYTES) return text('Boş veya çok büyük gövde', 413);
    const sha = up[1];
    if (hex(await crypto.subtle.digest('SHA-256', body)) !== sha) return text('sha256 uyuşmuyor', 422);
    await bucket.put(KEY_PREFIX + sha + '.mp4', body, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { uploadedAt: new Date().toISOString() },
    });
    const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_S;
    const sig = await signMedia(secret, sha, exp);
    return new Response(JSON.stringify({ ok: true, sha256: sha, size: body.byteLength, expires: exp, url: `${url.origin}/m/${sha}.mp4?exp=${exp}&sig=${sig}` }), {
      status: 201, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const obj = p.match(/^\/m\/([a-f0-9]{64})\.mp4$/);
  if (!obj) return text('Bulunamadı', 404);
  const sha = obj[1];
  const key = KEY_PREFIX + sha + '.mp4';

  if (request.method === 'DELETE') {
    if (!(await authorized(request, env))) return text('Yetkisiz', 401);
    await bucket.delete(key);
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method Not Allowed', 405, { allow: 'GET, HEAD, DELETE' });
  if (!(await verifyMediaSig(secret, sha, url.searchParams.get('exp'), url.searchParams.get('sig')))) return text('Link geçersiz veya süresi dolmuş', 403);

  const head = await bucket.head(key);
  if (!head) return text('Bulunamadı', 404);
  const size = head.size;
  const base = {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    etag: head.httpEtag,
    'x-content-type-options': 'nosniff',
  };
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid') return text('Range Not Satisfiable', 416, { 'content-range': `bytes */${size}` });
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...base, 'content-length': String(size) } });
  }
  if (range) {
    const part = await bucket.get(key, { range });
    if (!part) return text('Bulunamadı', 404);
    return new Response(part.body, { status: 206, headers: { ...base, 'content-length': String(range.length), 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` } });
  }
  const full = await bucket.get(key);
  if (!full) return text('Bulunamadı', 404);
  return new Response(full.body, { status: 200, headers: { ...base, 'content-length': String(size) } });
}
