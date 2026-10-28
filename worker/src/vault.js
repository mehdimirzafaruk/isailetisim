// Şifre kasası (/admin/kasa): ekibin platform şifreleri. Şifre ve not AES-256-GCM ile şifreli saklanır.
// Anahtar Worker secret'ı VAULT_KEY (base64, 32 bayt). Kasa, panel oturumuna ek olarak 15 dakikalık kilit çerezi ister (auth.js).
// Şifre ve not hiçbir yerde loglanmaz; liste HTML'inde de yoktur (Göster/Kopyala ayrı POST ile alır).
import * as db from './db.js';
import { checkPassword, createVaultCookie, clearVaultCookie, vaultOpenUntil } from './auth.js';
import { html, raw, page } from './html.js';
import { clip, ipHash, json, see, dayOf, fmtDateTime } from './util.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const VAULT_CATEGORIES = {
  pazaryeri: 'Pazaryeri', sosyal: 'Sosyal medya', reklam: 'Reklam hesapları', mail: 'E-posta',
  banka: 'Banka / ödeme', sunucu: 'Sunucu / alan adı', diger: 'Diğer',
};
const CAT_KEYS = Object.keys(VAULT_CATEGORIES);
const AUDIT_LABELS = { unlock: 'Kasa açıldı', create: 'Eklendi', update: 'Güncellendi', delete: 'Silindi', reveal: 'Gösterildi / kopyalandı', export: 'Tümü indirildi' };
const UID_RE = /^[0-9a-f]{16}$/;
const LIMITS = { title: 120, username: 200, email: 200, phone: 200, password: 1000, note: 5000 };

// ---------------------------------------------------------------- şifreleme
function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64Decode(str) {
  let s = String(str || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function keyBytes(env) {
  try {
    const b = b64Decode(env && env.VAULT_KEY);
    return b.length === 32 ? b : null;
  } catch { return null; }
}

/** VAULT_KEY tanımlı ve çözülünce tam 32 bayt mı? */
export function vaultConfigured(env) {
  return !!(env && env.VAULT_KEY && keyBytes(env));
}

// İzolat ömrü boyunca aynı anahtar bir kez içe aktarılır. Anahtar dışa aktarılamaz (extractable: false).
const keyCache = new Map();
function getKey(env) {
  const k = String(env.VAULT_KEY);
  let p = keyCache.get(k);
  if (!p) {
    const bytes = keyBytes(env);
    if (!bytes) throw new Error('VAULT_KEY geçersiz');
    p = crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    keyCache.clear();
    keyCache.set(k, p);
  }
  return p;
}

/** Metni şifreler: base64url(iv(12) || ciphertext+tag). AAD = uid (şifreli metin satıra bağlı). Boşsa null. */
export async function encryptField(env, uid, text) {
  if (text === null || text === undefined || text === '') return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(uid) }, await getKey(env), enc.encode(String(text))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64urlEncode(out);
}

/** Çözer; blob yoksa ''. AAD (uid) uyuşmazsa ya da veri bozuksa hata fırlatır. */
export async function decryptField(env, uid, blob) {
  if (blob === null || blob === undefined || blob === '') return '';
  const b = b64Decode(blob);
  if (b.length < 12 + 16) throw new Error('şifreli alan bozuk');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: enc.encode(uid) }, await getKey(env), b.slice(12));
  return dec.decode(pt);
}

/** Çözülemezse fırlatmak yerine null döner (liste/indirme bir kayıt yüzünden düşmesin). */
async function tryDecrypt(env, uid, blob) {
  try { return await decryptField(env, uid, blob); } catch { return null; }
}

function newUid() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- dışa aktarma (.txt)
const pad = (label) => label.padEnd(11, ' ');

/**
 * Düz metin döküm. entries: çözülmüş kayıtlar [{ title, url, username, email, phone, password, note, category, updated_at }].
 * Kategoriye göre gruplu (sabit sıra), grup içinde başlığa göre sıralı; boş alanlar atlanır. password/note null = çözülemedi.
 */
export function buildExportText(entries, now = Date.now()) {
  const lines = [`Yasomi şifre kasası — ${fmtDateTime(now)} (İstanbul)`, `Toplam ${entries.length} kayıt. Bu dosya düz metindir; işin bitince sil.`, ''];
  const field = (label, v) => {
    if (v === null) { lines.push(`  ${pad(label)}: (çözülemedi)`); return; }
    if (v === undefined || v === '') return;
    const [first, ...rest] = String(v).replace(/\r\n?/g, '\n').split('\n');
    lines.push(`  ${pad(label)}: ${first}`);
    for (const r of rest) lines.push(`${' '.repeat(15)}${r}`);
  };
  for (const cat of CAT_KEYS) {
    const group = entries.filter((e) => (CAT_KEYS.includes(e.category) ? e.category : 'diger') === cat)
      .sort((a, b) => String(a.title).localeCompare(String(b.title), 'tr', { sensitivity: 'base' }));
    if (!group.length) continue;
    lines.push(`=== ${VAULT_CATEGORIES[cat]} ===`, '');
    for (const e of group) {
      lines.push(String(e.title));
      field('URL', e.url);
      field('Kullanıcı', e.username);
      field('E-posta', e.email);
      field('Telefon', e.phone);
      field('Şifre', e.password);
      field('Not', e.note);
      if (e.updated_at) field('Güncelleme', fmtDateTime(e.updated_at));
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- doğrulama
/** Boş -> ''; http(s) adresi -> normalize; şemasız alan adı -> https:// eklenir; geçersiz -> null. */
export function normalizeVaultUrl(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && (u.hostname.includes('.') || u.hostname === 'localhost')) return u.toString().slice(0, 1000);
  } catch { /* geçersiz */ }
  return null;
}

function readForm(form) {
  const s = (k) => String(form.get(k) ?? '').trim();
  const cat = s('category');
  return {
    title: clip(s('title'), LIMITS.title) || '',
    urlRaw: s('url'),
    username: clip(s('username'), LIMITS.username),
    email: clip(s('email'), LIMITS.email),
    phone: clip(s('phone'), LIMITS.phone),
    category: CAT_KEYS.includes(cat) ? cat : 'diger',
    // Şifrede baştaki/sondaki boşluk anlamlı olabilir: kırpılmaz.
    password: clip(String(form.get('password') ?? ''), LIMITS.password),
    hasNote: form.has('note'),
    note: clip(String(form.get('note') ?? '').replace(/\s+$/, ''), LIMITS.note),
  };
}

function validate(v) {
  if (!v.title) return 'Platform / site adı gerekli.';
  const url = normalizeVaultUrl(v.urlRaw);
  if (url === null) return 'URL geçersiz: https://… biçiminde bir adres yaz ya da boş bırak.';
  v.url = url || null;
  return '';
}

// ---------------------------------------------------------------- yönlendirici
/** /admin/kasa* — panel oturumu admin.js'te doğrulandı; burada kasa kilidi ve rotalar. */
export async function handleVault(request, env, url, path) {
  const method = request.method;
  if (!vaultConfigured(env)) {
    if (method !== 'GET') return json({ ok: false, error: 'not_configured' }, 503);
    return page({ title: 'Kurulum eksik', nav: 'vault', body: html`<div class="card login"><h1>Kurulum eksik: VAULT_KEY</h1>
      <p>Kasa anahtarı tanımlı değil ya da 32 bayt değil. README'deki "Şifre kasası" bölümündeki <code>wrangler secret put VAULT_KEY</code> adımını uygula.</p></div>` }, 503);
  }

  if (path === '/admin/kasa/ac' && method === 'POST') return unlock(request, env);
  if (path === '/admin/kasa/kilitle' && method === 'POST') return see('/admin/kasa', { 'set-cookie': clearVaultCookie() });

  const openUntil = await vaultOpenUntil(request, env);
  if (!openUntil) {
    if (method === 'GET') return lockedPage({ next: url.pathname + url.search });
    // Normal form gönderimi kilit ekranına döner; fetch/JSON istekleri 403 alır (istemci sayfayı yeniler).
    if ((request.headers.get('accept') || '').includes('text/html')) return see('/admin/kasa');
    return json({ ok: false, error: 'locked' }, 403);
  }

  if (path === '/admin/kasa' && method === 'GET') return listPage(env, url, openUntil);
  if (path === '/admin/kasa/yeni') return method === 'POST' ? createEntry(request, env) : formPage({ entry: null, values: {} });
  if (path === '/admin/kasa/indir' && method === 'POST') return exportTxt(request, env);

  const m = path.match(/^\/admin\/kasa\/([^/]+)(\/[a-z]+)?$/);
  if (m && UID_RE.test(m[1])) {
    const uid = m[1], sub = m[2] || '';
    const entry = await db.getVaultEntry(env.DB, uid);
    if (!entry) return sub === '/goster' ? json({ ok: false, error: 'not_found' }, 404) : notFound();
    if (sub === '/goster' && method === 'POST') return reveal(request, env, entry);
    if (sub === '/sil' && method === 'POST') return deleteEntry(request, env, entry);
    if (sub === '') return method === 'POST' ? saveEntry(request, env, entry) : editPage(env, entry);
  }
  return notFound();
}

function notFound() {
  return page({ title: 'Bulunamadı', nav: 'vault', body: html`<div class="card"><h1>Kayıt bulunamadı</h1><p><a href="/admin/kasa">Kasaya dön</a></p></div>` }, 404);
}

async function audit(request, env, action, entry = null) {
  await db.addVaultAudit(env.DB, { action, entry_uid: entry?.uid ?? null, title: entry?.title ?? null, ip_hash: await ipHash(request, env) });
}

// ---------------------------------------------------------------- simgeler (satır içi SVG)
const svg = (d, size = 16) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const I = {
  lock: (s) => svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', s),
  user: () => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  mail: () => svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  phone: () => svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  link: () => svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  key: () => svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/>'),
  eye: () => svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 14),
  shield: () => svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 15),
};

const AVATAR_COLORS = ['#26B0DE', '#157A9B', '#7048E8', '#E8590C', '#2F9E44', '#C2255C', '#1971C2', '#B4590B'];
function avatarColor(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const initial = (s) => (String(s).trim()[0] || '?').toLocaleUpperCase('tr');
const shortUrl = (u) => {
  const s = String(u).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
};

// ---------------------------------------------------------------- kilit
function lockedPage({ next = '/admin/kasa', error = '' }, status = 200) {
  const body = html`<div class="card vlock">
    ${I.lock(40)}
    <h1>Kasa kilitli</h1>
    <p class="small muted">Şifreleri görmek için panel şifresini tekrar gir. Kasa 15 dakika açık kalır.</p>
    ${error ? html`<div class="alert err">${error}</div>` : ''}
    <form method="post" action="/admin/kasa/ac">
      <input type="hidden" name="next" value="${next}">
      <div class="f"><label for="vpw">Panel şifresi</label><input id="vpw" type="password" name="password" autocomplete="current-password" required autofocus></div>
      <button class="btn" type="submit" style="width:100%;justify-content:center">Kasayı aç</button>
    </form></div>`;
  return page({ title: 'Kasa kilitli', nav: 'vault', body }, status);
}

async function unlock(request, env) {
  const form = await request.formData();
  let next = String(form.get('next') || '/admin/kasa');
  if (!/^\/admin\/kasa(\/|$|\?)/.test(next) || next.startsWith('/admin/kasa/ac')) next = '/admin/kasa';
  const res = await checkPassword(request, env, String(form.get('password') || ''));
  if (res.status === 429) return lockedPage({ next, error: 'Çok fazla deneme. 10 dakika sonra tekrar dene.' }, 429);
  if (!res.ok) return lockedPage({ next, error: 'Şifre yanlış.' }, 401);
  await audit(request, env, 'unlock');
  return see(next, { 'set-cookie': await createVaultCookie(env) });
}

// ---------------------------------------------------------------- liste
const OK_MSG = { eklendi: 'Kayıt eklendi.', kayit: 'Değişiklikler kaydedildi.', silindi: 'Kayıt silindi.' };

function openStrip() {
  return html`<div class="vault-strip">${I.shield()}<span>Kasa açık · 15 dakika sonra kendini kilitler · AES-256 ile şifreli saklanır</span></div>`;
}

function vcard(e) {
  const q = [e.title, e.username, e.email, e.url].filter(Boolean).join(' ').toLocaleLowerCase('tr');
  const line = (icon, value, copy = true) => html`<div class="vrow"><span class="k">${icon}</span><span class="v" title="${value}">${value}</span>${copy ? html`<button class="btn ghost sm" type="button" data-copy="${value}">Kopyala</button>` : ''}</div>`;
  const canReveal = e.has_pw || e.has_note;
  return html`<div class="vcard" data-uid="${e.uid}" data-cat="${e.category}" data-q="${q}">
    <div class="hd"><span class="avatar" style="background:${avatarColor(e.title)}">${initial(e.title)}</span>
      <div class="t"><b title="${e.title}">${e.title}</b><span class="badge">${VAULT_CATEGORIES[e.category] || 'Diğer'}</span></div></div>
    ${e.username ? line(I.user(), e.username) : ''}
    ${e.email ? line(I.mail(), e.email) : ''}
    ${e.phone ? line(I.phone(), e.phone) : ''}
    ${e.url ? html`<div class="vrow"><span class="k">${I.link()}</span><span class="v"><a href="${e.url}" target="_blank" rel="noopener noreferrer">${shortUrl(e.url)}</a></span></div>` : ''}
    <div class="vrow"><span class="k">${I.key()}</span><span class="v pw" data-pw>${e.has_pw ? '••••••••' : raw('<span class="muted small">şifre yok</span>')}</span></div>
    <div class="vnote" data-note hidden></div>
    <div class="vacts">
      ${canReveal ? html`<button class="btn ghost sm" type="button" data-act="show">${I.eye()}<span>Göster</span></button>` : ''}
      ${e.has_pw ? html`<button class="btn ghost sm" type="button" data-act="copy">Şifreyi kopyala</button>` : ''}
      <a class="btn ghost sm" href="/admin/kasa/${e.uid}">Düzenle</a>
    </div>
  </div>`;
}

async function listPage(env, url, openUntil) {
  const [entries, log] = await Promise.all([db.listVaultEntries(env.DB), db.recentVaultAudit(env.DB, 15)]);
  entries.sort((a, b) => String(a.title).localeCompare(String(b.title), 'tr', { sensitivity: 'base' }));
  for (const e of entries) if (!CAT_KEYS.includes(e.category)) e.category = 'diger';
  const counts = Object.fromEntries(CAT_KEYS.map((k) => [k, entries.filter((e) => e.category === k).length]));
  const ok = OK_MSG[url.searchParams.get('ok')];
  const leftMs = Math.max(0, openUntil - Date.now());

  const chips = html`<div class="chips" id="vchips"><button type="button" class="on" data-cat="">Tümü<b>${entries.length}</b></button>${CAT_KEYS.filter((k) => counts[k]).map((k) => html`<button type="button" data-cat="${k}">${VAULT_CATEGORIES[k]}<b>${counts[k]}</b></button>`)}</div>`;

  const body = html`
    ${openStrip()}
    ${ok ? html`<div class="alert ok">${ok}</div>` : ''}
    <div class="row" style="margin-bottom:12px"><h1 style="margin:0">Şifre kasası</h1><span class="spacer"></span>
      <form method="post" action="/admin/kasa/kilitle"><button class="btn ghost sm" type="submit">${I.lock(14)} Kilitle</button></form></div>
    ${entries.length ? html`
      <div class="vbar">
        <input type="search" id="vq" placeholder="Ara: platform, kullanıcı, e-posta, adres" autocomplete="off" spellcheck="false" aria-label="Ara">
        <a class="btn" href="/admin/kasa/yeni">+ Yeni kayıt</a>
        <form method="post" action="/admin/kasa/indir" data-confirm="Tüm şifreler düz metin olarak inecek. Dosyayı güvenli yerde sakla. Devam?"><button class="btn ghost" type="submit">Tümünü indir (.txt)</button></form>
      </div>
      ${chips}
      <div class="vault-grid">${entries.map(vcard)}</div>
      <p class="muted small" id="vnone" hidden>Eşleşen kayıt yok.</p>`
    : html`<div class="card vempty">${I.lock(36)}<h2 style="margin-top:8px">Kasa boş</h2>
        <p class="muted small">Pazaryeri panelleri, sosyal hesaplar, reklam hesapları, mail… Hepsini tek yerde, şifreli tut.</p>
        <a class="btn" href="/admin/kasa/yeni">+ İlk kaydı ekle</a></div>`}
    <details class="card" style="margin-top:16px"><summary class="small" style="cursor:pointer;font-weight:600">Son hareketler</summary>
      ${log.length ? html`<div class="tw" style="margin-top:8px"><table><thead><tr><th>Tarih</th><th>İşlem</th><th>Kayıt</th></tr></thead><tbody>
        ${log.map((a) => html`<tr><td>${fmtDateTime(a.ts)}</td><td>${AUDIT_LABELS[a.action] || a.action}</td><td>${a.title || ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted small">Henüz hareket yok.</p>`}
    </details>
    <script>${raw(listJs(leftMs))}</script>`;
  return page({ title: 'Şifre kasası', nav: 'vault', body });
}

// İstemci: arama + kategori filtresi, Göster (30 sn sonra gizlenir), şifre kopyalama, süre dolunca kilit ekranı.
function listJs(leftMs) {
  return `(function(){
  var q=document.getElementById('vq'),chips=document.getElementById('vchips'),none=document.getElementById('vnone');
  var cards=[].slice.call(document.querySelectorAll('.vcard')),cat='';
  function apply(){var s=q?(q.value||'').toLocaleLowerCase('tr').trim():'';var shown=0;
    cards.forEach(function(c){var ok=(!cat||c.dataset.cat===cat)&&(!s||c.dataset.q.indexOf(s)>=0);c.hidden=!ok;if(ok)shown++});
    if(none)none.hidden=shown>0||!cards.length}
  if(q)q.addEventListener('input',apply);
  if(chips)chips.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;cat=b.dataset.cat;
    chips.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});apply()});
  function reveal(uid){
    return fetch('/admin/kasa/'+uid+'/goster',{method:'POST',credentials:'same-origin',headers:{accept:'application/json'}}).then(function(r){
      if(r.status===403){location.reload();throw new Error('locked')}
      return r.json().catch(function(){location.reload();throw new Error('locked')}).then(function(d){
        if(!d||!d.ok){if(d&&d.error==='locked')location.reload();throw new Error((d&&d.error)||'hata')}return d})});
  }
  function flash(b,msg){var o=b.innerHTML;b.textContent=msg;setTimeout(function(){b.innerHTML=o},1600)}
  var timers={};
  function hide(card){var pw=card.querySelector('[data-pw]'),nt=card.querySelector('[data-note]'),btn=card.querySelector('[data-act=show] span');
    if(pw.dataset.has==='1')pw.textContent='••••••••';nt.textContent='';nt.hidden=true;if(btn)btn.textContent='Göster';card.classList.remove('open');
    clearTimeout(timers[card.dataset.uid])}
  function show(card,d){var pw=card.querySelector('[data-pw]'),nt=card.querySelector('[data-note]'),btn=card.querySelector('[data-act=show] span');
    if(d.password){pw.dataset.has='1';pw.textContent=d.password}
    if(d.note){nt.textContent=d.note;nt.hidden=false}
    if(btn)btn.textContent='Gizle';card.classList.add('open');
    clearTimeout(timers[card.dataset.uid]);timers[card.dataset.uid]=setTimeout(function(){hide(card)},30000)}
  function copyPw(uid,b){
    var done=function(){flash(b,'Kopyalandı ✓')},fail=function(e){if(!e||e.message!=='locked')flash(b,'Kopyalanamadı')};
    var txt=reveal(uid).then(function(d){return d.password||''});
    var plain=function(){return txt.then(function(t){return navigator.clipboard.writeText(t)})};
    // Safari: pano yazımı tıklama anında başlamalı; ClipboardItem sözü (promise) bunu sağlar.
    try{if(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write){
      navigator.clipboard.write([new ClipboardItem({'text/plain':txt.then(function(t){return new Blob([t],{type:'text/plain'})})})]).then(done,function(){plain().then(done,fail)});return}}catch(_){}
    if(navigator.clipboard)plain().then(done,fail);else txt.then(function(){fail()},fail);
  }
  document.addEventListener('click',function(e){var b=e.target.closest('[data-act]');if(!b)return;
    var card=b.closest('.vcard');if(!card)return;var uid=card.dataset.uid;
    if(b.dataset.act==='show'){if(card.classList.contains('open')){hide(card);return}
      reveal(uid).then(function(d){show(card,d)},function(err){if(err.message!=='locked')flash(b,'Çözülemedi')})}
    if(b.dataset.act==='copy')copyPw(uid,b);
  });
  document.querySelectorAll('[data-pw]').forEach(function(p){if(p.textContent.indexOf('•')===0)p.dataset.has='1'});
  // Kasa süresi dolunca kilit ekranına düş.
  setTimeout(function(){location.reload()},${Number(leftMs) + 1500});
})();`;
}

// ---------------------------------------------------------------- form
function entryForm({ entry, values: v, error = '', noteError = false }) {
  const edit = !!entry;
  const catOpts = CAT_KEYS.map((k) => html`<option value="${k}" ${(v.category || 'diger') === k ? raw('selected') : ''}>${VAULT_CATEGORIES[k]}</option>`);
  const nf = (id, label, attrs) => html`<div class="f"><label for="${id}">${label}</label>${attrs}</div>`;
  return html`
    ${error ? html`<div class="alert err">${error}</div>` : ''}
    <form method="post" class="card vform" autocomplete="off">
      ${nf('vt', 'Platform / site adı *', html`<input id="vt" name="title" value="${v.title || ''}" placeholder="Trendyol satıcı paneli" required maxlength="${LIMITS.title}">`)}
      ${nf('vu', 'URL', html`<input id="vu" name="url" value="${v.url ?? v.urlRaw ?? ''}" placeholder="https://partner.trendyol.com" maxlength="1000" inputmode="url" autocapitalize="off" spellcheck="false">`)}
      <div class="grid two" style="gap:0 12px">
        ${nf('vn', 'Kullanıcı adı', html`<input id="vn" name="username" value="${v.username || ''}" maxlength="${LIMITS.username}" autocapitalize="off" spellcheck="false" autocomplete="off">`)}
        ${nf('ve', 'E-posta', html`<input id="ve" name="email" value="${v.email || ''}" maxlength="${LIMITS.email}" inputmode="email" autocapitalize="off" spellcheck="false" autocomplete="off">`)}
        ${nf('vp', 'Telefon', html`<input id="vp" name="phone" value="${v.phone || ''}" maxlength="${LIMITS.phone}" inputmode="tel" autocomplete="off">`)}
        ${nf('vc', 'Kategori', html`<select id="vc" name="category">${catOpts}</select>`)}
      </div>
      <div class="f"><label for="vpw">Şifre</label>
        <div class="pwbox"><input id="vpw" type="password" name="password" maxlength="${LIMITS.password}" autocomplete="new-password" autocapitalize="off" spellcheck="false"
          placeholder="${edit ? 'Değiştirmek için yaz, boş bırakırsan aynı kalır' : ''}">
          <button class="btn ghost sm" type="button" id="vpweye">Göster</button><button class="btn ghost sm" type="button" id="vpwgen">Üret</button></div>
        <span class="hint">Üret: 20 karakter, harf + rakam + sembol.</span></div>
      ${noteError
        ? html`<div class="f"><label>Not</label><div class="alert err" style="margin:0">Not çözülemedi; kaydedersen eski not olduğu gibi kalır.</div></div>`
        : nf('vno', 'Not', html`<textarea id="vno" name="note" rows="4" maxlength="${LIMITS.note}" placeholder="2FA hangi telefonda, kurtarma kodları, kimin hesabı…">${v.note || ''}</textarea>`)}
      <div class="row"><button class="btn" type="submit">${edit ? 'Kaydet' : 'Kaydı ekle'}</button>
        <a class="btn ghost" href="/admin/kasa">Vazgeç</a></div>
    </form>
    ${edit ? html`<form method="post" action="/admin/kasa/${entry.uid}/sil" data-confirm="${`"${entry.title}" kaydı kalıcı olarak silinsin mi?`}" class="vform">
      <button class="btn danger sm" type="submit">Kaydı sil</button></form>` : ''}
    <script>${raw(formJs())}</script>`;
}

function formJs() {
  return `(function(){
  var p=document.getElementById('vpw'),eye=document.getElementById('vpweye'),gen=document.getElementById('vpwgen');
  function vis(on){p.type=on?'text':'password';eye.textContent=on?'Gizle':'Göster'}
  eye.addEventListener('click',function(){vis(p.type==='password')});
  // Kriptografik rastgele, modülo sapmasız; harf, rakam ve sembol en az birer tane. Karışan karakterler (0 O 1 l I) yok.
  function make(n){var A='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?.:',lim=Math.floor(4294967296/A.length)*A.length;
    for(;;){var out='',buf=new Uint32Array(n*3);crypto.getRandomValues(buf);
      for(var i=0;i<buf.length&&out.length<n;i++)if(buf[i]<lim)out+=A[buf[i]%A.length];
      if(out.length===n&&/[A-Za-z]/.test(out)&&/[0-9]/.test(out)&&/[^A-Za-z0-9]/.test(out))return out}}
  gen.addEventListener('click',function(){p.value=make(20);vis(true);p.focus()});
})();`;
}

function formPage({ entry, values, error = '', noteError = false }, status = 200) {
  const title = entry ? `Düzenle: ${entry.title}` : 'Yeni kayıt';
  return page({ title, nav: 'vault', body: html`${openStrip()}<h1>${title}</h1>${entryForm({ entry, values, error, noteError })}` }, status);
}

async function editPage(env, entry) {
  const note = await tryDecrypt(env, entry.uid, entry.note_enc);
  return formPage({ entry, values: { ...entry, note: note ?? '' }, noteError: note === null });
}

async function createEntry(request, env) {
  const v = readForm(await request.formData());
  const err = validate(v);
  if (err) return formPage({ entry: null, values: { ...v, password: '' }, error: err }, 400);
  const uid = newUid();
  await db.createVaultEntry(env.DB, uid, {
    title: v.title, url: v.url, username: v.username, email: v.email, phone: v.phone, category: v.category,
    password_enc: await encryptField(env, uid, v.password), note_enc: await encryptField(env, uid, v.note),
  });
  await audit(request, env, 'create', { uid, title: v.title });
  return see('/admin/kasa?ok=eklendi');
}

async function saveEntry(request, env, entry) {
  const v = readForm(await request.formData());
  const err = validate(v);
  if (err) {
    const note = v.hasNote ? v.note : await tryDecrypt(env, entry.uid, entry.note_enc);
    return formPage({ entry, values: { ...v, password: '', note: note ?? '' }, error: err, noteError: !v.hasNote && note === null }, 400);
  }
  await db.updateVaultEntry(env.DB, entry.uid, {
    title: v.title, url: v.url, username: v.username, email: v.email, phone: v.phone, category: v.category,
    // Boş şifre alanı = değişmedi. Not alanı formda yoksa (çözülemediği için gösterilmedi) eski not kalır.
    password_enc: v.password ? await encryptField(env, entry.uid, v.password) : entry.password_enc,
    note_enc: v.hasNote ? await encryptField(env, entry.uid, v.note) : entry.note_enc,
  });
  await audit(request, env, 'update', { uid: entry.uid, title: v.title });
  return see('/admin/kasa?ok=kayit');
}

async function deleteEntry(request, env, entry) {
  await db.deleteVaultEntry(env.DB, entry.uid);
  await audit(request, env, 'delete', entry);
  return see('/admin/kasa?ok=silindi');
}

// ---------------------------------------------------------------- göster / indir
async function reveal(request, env, entry) {
  const [password, note] = await Promise.all([tryDecrypt(env, entry.uid, entry.password_enc), tryDecrypt(env, entry.uid, entry.note_enc)]);
  if (password === null || note === null) return json({ ok: false, error: 'decrypt' }, 500);
  await audit(request, env, 'reveal', entry);
  return json({ ok: true, password, note }, 200, { 'referrer-policy': 'no-referrer' });
}

async function exportTxt(request, env) {
  const rows = await db.allVaultEntries(env.DB);
  const entries = await Promise.all(rows.map(async (r) => ({
    ...r, password: await tryDecrypt(env, r.uid, r.password_enc), note: await tryDecrypt(env, r.uid, r.note_enc),
  })));
  const now = Date.now();
  await audit(request, env, 'export');
  return new Response(buildExportText(entries, now), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="yasomi-sifreler-${dayOf(now)}.txt"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
    },
  });
}

