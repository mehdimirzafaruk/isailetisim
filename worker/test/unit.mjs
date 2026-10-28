// Saf mantık testleri (Cloudflare gerektirmez): node test/unit.mjs
import assert from 'node:assert/strict';
import * as u from '../src/util.js';
import { esc, html, fmtNum, fmtTRY, barChart, chartBlock } from '../src/html.js';
import { createSessionCookie, verifySessionValue, safeEqual } from '../src/auth.js';
import { buildLocation } from '../src/track.js';

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
  assert.equal(buildLocation('/', 'ayse', 'https://isailetisim.com'), '/?ref=ayse');
  assert.equal(buildLocation('/#urun-c11-pro', 'ayse', 'https://isailetisim.com'), '/?ref=ayse#urun-c11-pro');
  assert.equal(buildLocation('https://www.trendyol.com/p/1', 'ayse', 'x://'), 'https://www.trendyol.com/p/1');
  const y = new URL(buildLocation('https://www.yasomi.com.tr/urun', 'ayse', 'https://isailetisim.com'));
  assert.equal(y.searchParams.get('utm_content'), 'ayse');
  assert.equal(y.searchParams.get('utm_source'), 'bio');
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
console.log(`unit: ${n} test grubu geçti`);
