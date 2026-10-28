// Saf mantık testleri (Cloudflare gerektirmez): node test/unit.mjs
import assert from 'node:assert/strict';
import * as u from '../src/util.js';
import { esc, html, fmtNum, fmtTRY, barChart, chartBlock } from '../src/html.js';
import { createSessionCookie, verifySessionValue, safeEqual, createVaultCookie, verifyVaultValue, VAULT_MS } from '../src/auth.js';
import { encryptField, decryptField, vaultConfigured, buildExportText, normalizeVaultUrl } from '../src/vault.js';
import { layout, page } from '../src/html.js';
import { buildLocation } from '../src/track.js';
import { detectSource, sourceFromTag, sourceFromReferer, trafficLabel } from '../src/sources.js';
import { ticimaxSnippets } from '../src/snippets.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; };

await t('slugify', () => {
  assert.equal(u.slugify('Ayşe Kaya'), 'ayse-kaya');
  assert.equal(u.slugify('İlker IŞIK Öztürk'), 'ilker-isik-ozturk');
  assert.equal(u.slugify('  --Çağrı & Gül!! '), 'cagri-gul');
});
await t('isValidCode', () => {
  assert.ok(u.isValidCode('ayse-kaya'));
  assert.ok(!u.isValidCode('-ayse'));
  assert.ok(!u.isValidCode('Ayse'));
  assert.ok(!u.isValidCode('admin'));
  assert.ok(!u.isValidCode('a'.repeat(41)));
  for (const c of ['ig', 'tt', 'fb', 'x', 'yt', 'ln', 'wa', 'tg', 'api', 'assets', 'i']) assert.ok(!u.isValidCode(c), `${c} ayrılmış`);
  assert.ok(u.isValidCode('igx') && u.isValidCode('xx'));
});
await t('sourceFromTag', () => {
  assert.equal(sourceFromTag('ig'), 'instagram');
  assert.equal(sourceFromTag('TT'), 'tiktok');
  assert.equal(sourceFromTag('x'), 'x');
  assert.equal(sourceFromTag('tg'), 'telegram');
  assert.equal(sourceFromTag('Kasım Çekiliş!!'), 's:kasim-cekilis');
  assert.equal(sourceFromTag('a'.repeat(30)), 's:' + 'a'.repeat(20));
  assert.equal(sourceFromTag('<script>'), 's:script');
  assert.equal(sourceFromTag('!!!'), null);
  assert.equal(sourceFromTag(''), null);
});
await t('sourceFromReferer', () => {
  const r = (x) => sourceFromReferer(x, 'yasomi.net');
  assert.equal(r('https://l.instagram.com/?u=x'), 'instagram');
  assert.equal(r('https://www.instagram.com/yasomi'), 'instagram');
  assert.equal(r('https://www.tiktok.com/@yasomi'), 'tiktok');
  for (const h of ['facebook.com', 'l.facebook.com', 'lm.facebook.com', 'm.facebook.com']) assert.equal(r(`https://${h}/`), 'facebook');
  for (const h of ['t.co', 'x.com', 'twitter.com']) assert.equal(r(`https://${h}/`), 'x');
  for (const h of ['youtube.com', 'm.youtube.com', 'youtu.be']) assert.equal(r(`https://${h}/`), 'youtube');
  for (const h of ['linkedin.com', 'lnkd.in']) assert.equal(r(`https://${h}/`), 'linkedin');
  for (const h of ['google.com', 'www.google.com.tr', 'google.de']) assert.equal(r(`https://${h}/`), 'google');
  for (const h of ['web.whatsapp.com', 'wa.me']) assert.equal(r(`https://${h}/`), 'whatsapp');
  for (const h of ['t.me', 'telegram.org']) assert.equal(r(`https://${h}/`), 'telegram');
  assert.equal(r('https://www.trendyol.com/x'), 'web:trendyol.com');
  assert.equal(r('https://' + 'a'.repeat(60) + '.com/'), ('web:' + 'a'.repeat(60)).slice(0, 40));
  assert.equal(r('https://notgoogle.com/'), 'web:notgoogle.com');
  assert.equal(r('https://yasomi.net/#x'), null, 'kendi alan adı yok sayılır');
  assert.equal(r('https://www.yasomi.net/'), null);
  assert.equal(r('https://isailetisim.com/#x'), null, 'eski alan adı da kendi sayılır');
  assert.equal(r('https://www.isailetisim.com/'), null);
  assert.equal(sourceFromReferer('https://yasomi.net/', 'x.workers.dev'), null, 'workers.dev üzerinden de');
  assert.equal(r('https://yasomi.com.tr/'), 'web:yasomi.com.tr', 'marka sitesi kendi değil');
  assert.equal(r('android-app://com.instagram.android/'), 'instagram');
  assert.equal(r('nope'), null);
  assert.equal(r(null), null);
});
await t('detectSource öncelik', () => {
  const U = 'https://yasomi.net/';
  const d = (q, referer, browser) => detectSource({ url: U + q, referer, browser });
  assert.deepEqual(d('?s=ig', 'https://l.facebook.com/', 'TikTok in-app'), { source: 'instagram', code: null });
  assert.deepEqual(d('?s=kampanya&ref=ayse', null, null), { source: 's:kampanya', code: null });
  assert.deepEqual(d('?ref=ayse-kaya', 'https://l.instagram.com/', 'Instagram in-app'), { source: 'influencer', code: 'ayse-kaya' });
  assert.deepEqual(d('?ref=Bad--', 'https://l.facebook.com/', null), { source: 'facebook', code: null });
  assert.deepEqual(d('', 'https://l.facebook.com/', 'Instagram in-app'), { source: 'facebook', code: null });
  assert.deepEqual(d('', null, 'Instagram in-app'), { source: 'instagram', code: null });
  assert.deepEqual(d('', null, 'TikTok in-app'), { source: 'tiktok', code: null });
  assert.deepEqual(d('', null, 'Facebook in-app'), { source: 'facebook', code: null });
  assert.deepEqual(d('', 'https://yasomi.net/', 'Safari'), { source: 'direkt', code: null });
  assert.deepEqual(d('', null, 'Chrome'), { source: 'direkt', code: null });
  assert.deepEqual(detectSource({ url: U + '?ref=ayse', referer: null, browser: 'Instagram in-app', ignoreRef: true }), { source: 'instagram', code: null });
});
await t('trafficLabel', () => {
  assert.equal(trafficLabel('instagram'), 'Instagram');
  assert.equal(trafficLabel('influencer'), 'Influencer linkleri');
  assert.equal(trafficLabel('web'), 'Diğer web');
  assert.equal(trafficLabel('web:trendyol.com'), 'trendyol.com');
  assert.equal(trafficLabel('s:kampanya'), 'Etiket: kampanya');
  assert.equal(trafficLabel(null), 'Direkt');
});
await t('dayOf Istanbul', () => {
  assert.equal(u.dayOf(Date.parse('2026-10-28T20:59:59Z')), '2026-10-28');
  assert.equal(u.dayOf(Date.parse('2026-10-28T21:00:00Z')), '2026-10-29');
  assert.equal(u.fmtDateTime(Date.parse('2026-10-28T21:05:00Z')), '29.10.2026 00:05');
  assert.equal(u.dayOf(u.noonOfDay('2026-10-30')), '2026-10-30');
});
await t('parseUA', () => {
  const ig = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0';
  assert.deepEqual(u.parseUA(ig), { device: 'mobile', browser: 'Instagram in-app' });
  const tt = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 trill_350 BytedanceWebview/d8a21c6';
  assert.deepEqual(u.parseUA(tt), { device: 'mobile', browser: 'TikTok in-app' });
  assert.equal(u.parseUA('Mozilla/5.0 [FBAN/FBIOS;FBAV/450.0] iPhone').browser, 'Facebook in-app');
  assert.deepEqual(u.parseUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), { device: 'desktop', browser: 'Safari' });
  assert.equal(u.parseUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) CriOS/120 Mobile').device, 'tablet');
  assert.equal(u.parseUA('facebookexternalhit/1.1').browser, 'Bot');
  assert.equal(u.parseUA('WhatsApp/2.23').browser, 'Bot');
  assert.equal(u.parseUA('curl/8.7.1').browser, 'Bot');
  assert.equal(u.parseUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120 Safari/537.36').browser, 'Bot');
  assert.equal(u.parseUA('Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 Chrome-Lighthouse').browser, 'Bot');
});
await t('parseAmount', () => {
  assert.equal(u.parseAmount('5.999'), 5999);
  assert.equal(u.parseAmount('5.999,90 ₺'), 5999.9);
  assert.equal(u.parseAmount('5999.5'), 5999.5);
  assert.equal(u.parseAmount(1200), 1200);
  assert.ok(Number.isNaN(u.parseAmount('abc')));
});
await t('normalizeTarget', () => {
  assert.equal(u.normalizeTarget(''), '/');
  assert.equal(u.normalizeTarget('#urun-c11-pro'), '/#urun-c11-pro');
  assert.equal(u.normalizeTarget('javascript:alert(1)'), null);
  assert.equal(u.normalizeTarget('//evil.com'), null);
  assert.equal(u.normalizeTarget('https://www.trendyol.com/x'), 'https://www.trendyol.com/x');
});
await t('buildLocation', () => {
  assert.equal(buildLocation('/', 'ayse', 'https://yasomi.net'), '/?ref=ayse');
  assert.equal(buildLocation('/#urun-c11-pro', 'ayse', 'https://yasomi.net'), '/?ref=ayse#urun-c11-pro');
  assert.equal(buildLocation('https://www.trendyol.com/p/1', 'ayse', 'x://'), 'https://www.trendyol.com/p/1');
  const y = new URL(buildLocation('https://www.yasomi.com.tr/urun', 'ayse', 'https://yasomi.net'));
  assert.equal(y.searchParams.get('utm_content'), 'ayse');
  assert.equal(y.searchParams.get('utm_source'), 'bio');
});
await t('siteOrigin', () => {
  assert.equal(u.siteOrigin({ SITE_ORIGIN: 'https://yasomi.net' }), 'https://yasomi.net');
  assert.equal(u.siteOrigin({ SITE_ORIGIN: 'https://yasomi.net/' }), 'https://yasomi.net', 'sondaki / atılır');
  assert.equal(u.siteOrigin({}), 'https://yasomi.net', 'yoksa varsayılan');
  assert.equal(u.siteOrigin(undefined), 'https://yasomi.net');
  assert.equal(u.siteOrigin({ SITE_ORIGIN: 'yasomi.net' }), 'https://yasomi.net', 'şemasız değer geçersiz -> varsayılan');
  assert.equal(u.siteOrigin({ SITE_ORIGIN: 'http://localhost:8790' }), 'http://localhost:8790');
  assert.equal(u.siteHost({ SITE_ORIGIN: 'https://yasomi.net' }), 'yasomi.net');
  assert.ok(u.LEGACY_HOSTS.has('isailetisim.com') && u.LEGACY_HOSTS.has('www.isailetisim.com'));
  assert.ok(!u.LEGACY_HOSTS.has('yasomi.net'));
});
await t('ticimaxSnippets', () => {
  assert.ok(ticimaxSnippets().orderPage.includes("fetch('https://yasomi.net/api/purchase'"), 'varsayılan yasomi.net');
  assert.ok(ticimaxSnippets('https://ornek.test').orderPage.includes("fetch('https://ornek.test/api/purchase'"));
  assert.ok(ticimaxSnippets().allPages.includes("p.get('utm_source')==='bio'"));
});
await t('esc/html', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  const evil = '<script>alert(1)</script>';
  assert.ok(!String(html`<td>${evil}</td>`).includes('<script>'));
  assert.equal(String(html`<b>${[html`<i>${'<'}</i>`, '>']}</b>`), '<b><i>&lt;</i>&gt;</b>');
});
await t('fmt', () => {
  assert.equal(fmtNum(1234567), '1.234.567');
  assert.equal(fmtTRY(5999.9), '5.999,9 ₺');
  assert.equal(fmtTRY(5999), '5.999 ₺');
});
await t('session', async () => {
  const env = { SESSION_SECRET: 's'.repeat(32), ADMIN_PASSWORD: 'pw' };
  const c = await createSessionCookie(env);
  const val = c.split(';')[0].split('=')[1];
  assert.ok(await verifySessionValue(env, val));
  assert.ok(!(await verifySessionValue(env, val.slice(0, -2) + 'xx')));
  assert.ok(!(await verifySessionValue({ ...env, ADMIN_PASSWORD: 'yeni' }, val)), 'şifre değişince oturum düşer');
  assert.ok(!(await verifySessionValue(env, val, Date.now() + 8 * 86400e3)), 'süresi dolar');
  assert.ok(await safeEqual('a', 'a'));
  assert.ok(!(await safeEqual('a', 'b')));
});
await t('barChart', () => {
  const s = Array.from({ length: 90 }, (_, i) => ({ day: u.daysAgo(i), v: i % 7, c: i % 3, p: 0, r: 0 }));
  const svg = String(barChart(s));
  assert.ok(svg.startsWith('<svg'));
  assert.equal((String(chartBlock(s)).match(/<svg/g) || []).length, 2);
  assert.ok(svg.includes('<rect'));
});
// ---------- şifre kasası
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const venv = { VAULT_KEY: b64(crypto.getRandomValues(new Uint8Array(32))), SESSION_SECRET: 's', ADMIN_PASSWORD: 'p' };
await t('vault: yapılandırma', () => {
  assert.ok(vaultConfigured(venv));
  assert.ok(!vaultConfigured({}));
  assert.ok(!vaultConfigured({ VAULT_KEY: b64(new Uint8Array(16)) }), '16 bayt yetmez');
  assert.ok(!vaultConfigured({ VAULT_KEY: '***' }));
});
await t('vault: şifrele / çöz', async () => {
  const uid = '0123456789abcdef';
  const blob = await encryptField(venv, uid, 'Gizli şifre 🔑 çğıöşü');
  assert.match(blob, /^[A-Za-z0-9_-]+$/, 'base64url');
  assert.ok(!blob.includes('Gizli'));
  assert.equal(await decryptField(venv, uid, blob), 'Gizli şifre 🔑 çğıöşü');
  assert.notEqual(await encryptField(venv, uid, 'x'), await encryptField(venv, uid, 'x'), 'her seferinde yeni IV');
  await assert.rejects(decryptField(venv, 'fedcba9876543210', blob), 'farklı uid (AAD) ile çözülmez');
  const other = { ...venv, VAULT_KEY: b64(crypto.getRandomValues(new Uint8Array(32))) };
  await assert.rejects(decryptField(other, uid, blob), 'farklı anahtar ile çözülmez');
  const bytes = blob.slice(0, -4) + (blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(decryptField(venv, uid, bytes), 'bozuk veri');
  await assert.rejects(decryptField(venv, uid, 'abc'), 'çok kısa');
  assert.equal(await encryptField(venv, uid, ''), null);
  assert.equal(await encryptField(venv, uid, null), null);
  assert.equal(await decryptField(venv, uid, null), '');
});
await t('vault: kilit çerezi', async () => {
  const now = Date.now();
  const c = await createVaultCookie(venv, now);
  assert.match(c, /^yvault=v1\./);
  assert.ok(c.includes('Max-Age=900; Path=/admin/kasa; HttpOnly; Secure; SameSite=Strict'));
  const val = c.split(';')[0].split('=')[1];
  assert.equal(await verifyVaultValue(venv, val, now), now + VAULT_MS);
  assert.ok(await verifyVaultValue(venv, val, now + VAULT_MS - 1000), '15 dk dolmadan açık');
  assert.equal(await verifyVaultValue(venv, val, now + VAULT_MS + 1), false, 'süresi dolunca kilitli');
  assert.equal(await verifyVaultValue({ ...venv, VAULT_KEY: b64(new Uint8Array(32)) }, val, now), false, 'farklı VAULT_KEY');
  assert.equal(await verifyVaultValue({ ...venv, ADMIN_PASSWORD: 'yeni' }, val, now), false, 'şifre değişince kilitlenir');
  assert.equal(await verifyVaultValue(venv, val.slice(0, -2) + 'xx', now), false, 'imza bozuk');
  const sess = (await createSessionCookie(venv, now)).split(';')[0].split('=')[1];
  assert.equal(await verifyVaultValue(venv, sess, now), false, 'panel oturum çerezi kasayı açmaz');
  assert.equal(await verifyVaultValue(venv, '', now), false);
});
await t('vault: URL doğrulama', () => {
  assert.equal(normalizeVaultUrl(''), '');
  assert.equal(normalizeVaultUrl('https://partner.trendyol.com'), 'https://partner.trendyol.com/');
  assert.equal(normalizeVaultUrl('partner.trendyol.com/giris'), 'https://partner.trendyol.com/giris');
  assert.equal(normalizeVaultUrl('javascript:alert(1)'), null);
  assert.equal(normalizeVaultUrl('ftp://x.com'), null);
  assert.equal(normalizeVaultUrl('düz metin'), null);
});
await t('vault: buildExportText', () => {
  const now = Date.parse('2026-10-28T15:40:00Z'); // İstanbul 18:40
  const upd = Date.parse('2026-10-28T15:12:00Z');
  const txt = buildExportText([
    { title: 'Trendyol', url: 'https://partner.trendyol.com', username: 'yasomi', email: 'info@yasomi.com.tr', phone: '0532 000 00 00', password: 'Ş1fre!', note: 'satır 1\nsatır 2', category: 'pazaryeri', updated_at: upd },
    { title: 'Instagram', username: 'yasomi', password: 'ig-pw', note: '', category: 'sosyal', updated_at: upd },
    { title: 'Amazon', password: 'amz', category: 'pazaryeri', updated_at: upd },
    { title: 'Bozuk', password: null, category: 'tanimsiz', updated_at: upd },
  ], now);
  const lines = txt.split('\n');
  assert.equal(lines[0], 'Yasomi şifre kasası — 28.10.2026 18:40 (İstanbul)');
  assert.equal(lines[1], 'Toplam 4 kayıt. Bu dosya düz metindir; işin bitince sil.');
  assert.equal(lines[2], '');
  assert.equal(lines[3], '=== Pazaryeri ===');
  assert.equal(lines[5], 'Amazon', 'grup içinde başlığa göre sıralı');
  assert.ok(txt.includes(`Trendyol
  URL        : https://partner.trendyol.com
  Kullanıcı  : yasomi
  E-posta    : info@yasomi.com.tr
  Telefon    : 0532 000 00 00
  Şifre      : Ş1fre!
  Not        : satır 1
               satır 2
  Güncelleme : 28.10.2026 18:12
`));
  assert.ok(txt.indexOf('=== Pazaryeri ===') < txt.indexOf('=== Sosyal medya ===') && txt.indexOf('=== Sosyal medya ===') < txt.indexOf('=== Diğer ==='), 'sabit kategori sırası');
  const ig = txt.slice(txt.indexOf('Instagram'), txt.indexOf('=== Diğer'));
  assert.ok(!ig.includes('URL') && !ig.includes('E-posta') && !ig.includes('Not '), 'boş alanlar atlanır');
  assert.ok(txt.includes('Bozuk\n  Şifre      : (çözülemedi)'), 'bilinmeyen kategori Diğer; çözülemeyen işaretlenir');
  assert.ok(!txt.includes('=== Reklam'), 'boş kategori başlığı yok');
});
await t('panel: CSP + nonce', async () => {
  const h = layout({ title: 'x', body: html`<p>${'<script>alert(1)</script>'}</p><script>var a=1</script>`, nonce: 'N0nce' });
  assert.ok(h.includes('<script nonce="N0nce">var a=1</script>'));
  assert.ok(h.includes('&lt;script&gt;alert(1)'), 'kaçışlı metne nonce eklenmez');
  assert.equal((h.match(/<script>/g) || []).length, 0, 'nonce\'suz script kalmadı');
  assert.ok(h.includes('href="/admin/kasa"'), 'nav: Kasa');
  const r = page({ title: 'x', body: html`<script>1</script>` });
  const csp = r.headers.get('content-security-policy');
  const n = csp.match(/'nonce-([^']+)'/)[1];
  assert.ok((await r.text()).includes(`<script nonce="${n}">1</script>`));
  assert.ok(csp.includes("frame-ancestors 'none'") && csp.includes("form-action 'self'"));
});
console.log(`unit: ${n} test grubu geçti`);
