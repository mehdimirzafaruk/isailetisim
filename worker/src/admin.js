// /admin paneli: sunucu tarafında üretilen Türkçe HTML.
import * as db from './db.js';
import { isLoggedIn, attemptLogin, clearSessionCookie, authConfigured } from './auth.js';
import { html, raw, esc, page, layout, kpiRow, chartBlock, viewKpiRow, hourChart, fmtNum, fmtTRY, pct, PLATFORMS, SOURCE_LABELS, DEVICE_LABELS, TYPE_LABELS } from './html.js';
import { isValidCode, slugify, normalizeTarget, parseAmount, clip, dayOf, daysAgo, fmtDateTime, fmtDay, noonOfDay, parseCookies, RESERVED_CODES, CHANNELS, DAY_MS, siteOrigin, siteHost } from './util.js';
import { PURCHASE_SOURCES, NOVIEW_COOKIE } from './track.js';
import { trafficLabel } from './sources.js';
import { ticimaxSnippets } from './snippets.js';

const PER_PAGE = 100;

const linkFor = (env, code) => `${siteOrigin(env)}/i/${code}`;
const see = (location, headers = {}) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...headers } });

export async function handleAdmin(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/admin';
  const method = request.method;

  if (!authConfigured(env)) {
    return page({ title: 'Kurulum eksik', loggedIn: false, body: html`<div class="card login"><h1>Kurulum eksik</h1>
      <p>ADMIN_PASSWORD ve SESSION_SECRET secret'ları tanımlı değil. README'deki <code>wrangler secret put</code> adımlarını uygula.</p></div>` }, 503);
  }

  // Panel formları yalnız aynı kaynaktan gönderilebilir (çerez SameSite=Lax; bu ikinci kat).
  if (method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('Origin reddedildi', { status: 403 });
  }

  if (path === '/admin/login' && method === 'POST') return login(request, env);
  if (path === '/admin/logout' && method === 'POST') return see('/admin', { 'set-cookie': clearSessionCookie() });

  if (!(await isLoggedIn(request, env))) {
    if (method !== 'GET') return see('/admin');
    return loginPage({ next: url.pathname + url.search });
  }

  if (path === '/admin' && method === 'GET') return overview(env);
  if (path === '/admin/new') return method === 'POST' ? createLink(request, env) : newLinkPage(env, {});
  if (path === '/admin/settings' && method === 'GET') return settingsPage(request, env, url);
  if (path === '/admin/settings/noview' && method === 'POST') return setNoView(request);
  if (path === '/admin/ziyaretciler' && method === 'GET') return visitorsPage(env, url);
  if (path === '/admin/ziyaretciler/export.csv' && method === 'GET') return exportViewsCsv(env, url);

  const m = path.match(/^\/admin\/i\/([a-z0-9-]{1,40})(\/.*)?$/);
  if (m) {
    const code = m[1], sub = m[2] || '';
    const inf = await db.getInfluencer(env.DB, code);
    if (!inf) return notFound();
    if (sub === '' && method === 'GET') return detailPage(env, inf, url);
    if (sub === '/export.csv' && method === 'GET') return exportCsv(env, inf);
    if (sub === '/edit') return method === 'POST' ? saveEdit(request, env, inf) : editPage(env, inf, {});
    if (sub === '/toggle' && method === 'POST') {
      await db.setActive(env.DB, code, !inf.active);
      return see(`/admin/i/${code}?ok=${inf.active ? 'pasif' : 'aktif'}`);
    }
    if (sub === '/purchase' && method === 'POST') return addPurchase(request, env, inf);
    const dm = sub.match(/^\/purchase\/(\d+)\/delete$/);
    if (dm && method === 'POST') {
      await db.deletePurchase(env.DB, code, Number(dm[1]));
      return see(`/admin/i/${code}?ok=silindi#olaylar`);
    }
  }
  return notFound();
}

function notFound() {
  return page({ title: 'Bulunamadı', body: html`<div class="card"><h1>Sayfa bulunamadı</h1><p><a href="/admin">Genel bakışa dön</a></p></div>` }, 404);
}

// ---------------------------------------------------------------- giriş
function loginPage({ next = '/admin', error = '' }, status = 200) {
  const body = html`<div class="card login">
    <h1>Yasomi · Influencer paneli</h1>
    ${error ? html`<div class="alert err">${error}</div>` : ''}
    <form method="post" action="/admin/login">
      <input type="hidden" name="next" value="${next}">
      <div class="f"><label for="pw">Şifre</label><input id="pw" type="password" name="password" autocomplete="current-password" required autofocus></div>
      <button class="btn" type="submit">Giriş yap</button>
    </form></div>`;
  return page({ title: 'Giriş', body, loggedIn: false }, status);
}

async function login(request, env) {
  const form = await request.formData();
  let next = String(form.get('next') || '/admin');
  if (!/^\/admin(\/|$|\?)/.test(next)) next = '/admin';
  const res = await attemptLogin(request, env, String(form.get('password') || ''));
  if (res.ok) return see(next, { 'set-cookie': res.cookie });
  if (res.status === 429) return loginPage({ next, error: 'Çok fazla deneme. 10 dakika sonra tekrar dene.' }, 429);
  return loginPage({ next, error: 'Şifre yanlış.' }, 401);
}

// ---------------------------------------------------------------- bio sayfası ziyaretçileri: ortak parçalar
const OVERVIEW_PERIODS = [{ key: 'd30', label: '30 gün' }, { key: 'today', label: 'Bugün' }, { key: 'd7', label: '7 gün' }, { key: 'all', label: 'Tümü' }];
const ctrText = (c, v) => (v ? fmtNum((c / v) * 100, 1) + '%' : '–');

/** Kaynak tablosu: rows [{k, v, u, c}] (db.sourceBreakdown) */
function sourceTable(rows, totalViews) {
  if (!rows.length) return html`<p class="muted small">Bu dönemde ziyaret yok. Bio sayfası açıldıkça burada görünür.</p>`;
  return html`<div class="tw"><table class="srct"><thead><tr><th>Kaynak</th><th class="n"><span class="d-i">Ziyaret</span><span class="m-i">Ziy.</span></th><th class="n hm">Tekil</th><th class="n">Pay</th><th class="n"><span class="d-i">Tıklama</span><span class="m-i">Tık.</span></th><th class="n">CTR</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td class="src">${trafficLabel(r.k)}</td><td class="n">${fmtNum(r.v)}</td><td class="n hm">${fmtNum(r.u)}</td>
      <td class="n">${r.k === '?' ? '–' : pct(r.v, totalViews)}</td><td class="n">${fmtNum(r.c)}</td><td class="n">${r.k === '?' ? '–' : ctrText(r.c, r.v)}</td></tr>`)}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------- genel bakış
async function overview(env) {
  const now = Date.now();
  const d30 = daysAgo(29, now);
  const [list, t, vk, src] = await Promise.all([
    db.influencerStats(env.DB), db.totals(env.DB),
    db.viewKpis(env.DB, { today: daysAgo(0, now), d7: daysAgo(6, now), d30, all: null }),
    db.sourceBreakdown(env.DB, d30),
  ]);
  const cell = (s7, s30, sa, f = fmtNum) =>
    html`<td class="n" data-s7="${s7}" data-s30="${s30}" data-sa="${sa}" data-t7="${f(s7)}" data-t30="${f(s30)}" data-ta="${f(sa)}" data-sort="${s30}">${f(s30)}</td>`;
  const ctr = (c, v) => (v ? (c / v) * 100 : -1);
  const ctrF = (x) => (x < 0 ? '–' : fmtNum(x, 1) + '%');

  const rows = list.map((i) => html`<tr>
      <td data-sort="${i.name.toLocaleLowerCase('tr')}"><a class="nm" href="/admin/i/${i.code}">${i.name}<small>${i.platform || '—'} · ${i.code}${i.active ? '' : ' · pasif'}</small></a></td>
      ${cell(i.v7, i.v30, i.v)}
      ${cell(i.c7, i.c30, i.c)}
      ${cell(ctr(i.c7, i.v7), ctr(i.c30, i.v30), ctr(i.c, i.v), ctrF)}
      ${cell(i.p7, i.p30, i.p)}
      ${cell(i.r7, i.r30, i.r, fmtTRY)}
      <td data-sort="${i.last_ts || 0}">${i.last_ts ? fmtDateTime(i.last_ts) : raw('<span class="muted">—</span>')}</td>
      <td><button class="btn ghost sm" type="button" data-copy="${linkFor(env, i.code)}">Linki kopyala</button></td>
    </tr>`);

  const org = t.organic;
  const body = html`
    <div class="row" style="margin-bottom:12px"><h1 style="margin:0">Genel bakış</h1><span class="spacer"></span><a class="btn" href="/admin/new">+ Yeni link oluştur</a></div>
    <div class="sec">Bio sayfası · <span class="dom">${siteHost(env)}</span></div>
    ${viewKpiRow(vk, OVERVIEW_PERIODS, 'd30')}
    <div class="card" id="kaynaklar">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Nereden geliyorlar? <span class="muted small">(son 30 gün)</span></h2><span class="spacer"></span>
        <a class="btn ghost sm" href="/admin/ziyaretciler">Tüm ayrıntılar →</a></div>
      ${sourceTable(src, vk.d30.v)}
    </div>
    <div class="sec">Influencer linkleri</div>
    ${kpiRow(t.att)}
    <p class="small muted" style="margin:-6px 0 16px">Büyük sayı son 30 gün. Yalnız influencer linkiyle gelenler sayılır.
      Ref'siz (organik) son 30 gün: ${fmtNum(org.c30)} tıklama, ${fmtNum(org.p30)} satın alma (${fmtTRY(org.r30)}).</p>
    <div class="card">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Influencer'lar (${list.length})</h2><span class="spacer"></span>
        <div class="seg" id="period"><button type="button" data-p="7">7 gün</button><button type="button" data-p="30" class="on">30 gün</button><button type="button" data-p="a">Tümü</button></div></div>
      ${list.length ? html`<div class="tw"><table id="inf">
        <thead><tr><th class="sort">Influencer</th><th class="sort n">Ziyaret</th><th class="sort n">Tıklama</th><th class="sort n">CTR</th><th class="sort n">Satış</th><th class="sort n">Ciro</th><th class="sort">Son aktivite</th><th>Link</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : html`<p>Henüz link yok. <a href="/admin/new">İlk influencer linkini oluştur.</a></p>`}
    </div>
    <script>
    (function(){
      var t=document.getElementById('inf');if(!t)return;
      var seg=document.getElementById('period');
      seg.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
        seg.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});
        var p=b.dataset.p;
        t.querySelectorAll('td[data-s7]').forEach(function(td){td.textContent=td.dataset['t'+p];td.dataset.sort=td.dataset['s'+p]});
        var h=t.querySelector('th.asc,th.desc');if(h){var asc=h.classList.contains('asc');sortBy(h,asc)}
      });
      var ths=t.querySelectorAll('th.sort');
      function sortBy(th,asc){
        var idx=[].indexOf.call(th.parentNode.children,th);var tb=t.tBodies[0];
        var rows=[].slice.call(tb.rows);
        rows.sort(function(a,b){var x=a.cells[idx].dataset.sort,y=b.cells[idx].dataset.sort;
          var nx=parseFloat(x),ny=parseFloat(y);var r=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y),'tr');return asc?r:-r});
        rows.forEach(function(r){tb.appendChild(r)});
        ths.forEach(function(x){x.classList.remove('asc','desc')});th.classList.add(asc?'asc':'desc');
      }
      ths.forEach(function(th){th.addEventListener('click',function(){sortBy(th,th.classList.contains('desc'))})});
    })();
    </script>`;
  return page({ title: 'Genel bakış', nav: 'home', body });
}

// ---------------------------------------------------------------- yeni link / düzenle
function linkForm(env, v, { edit = false, error = '' } = {}) {
  const platformOpts = PLATFORMS.map((p) => html`<option ${v.platform === p ? raw('selected') : ''}>${p}</option>`);
  return html`
    ${error ? html`<div class="alert err">${error}</div>` : ''}
    <form method="post" class="card" id="lf" style="max-width:640px">
      <div class="f"><label for="name">İsim</label><input id="name" name="name" value="${v.name || ''}" placeholder="Ayşe Kaya" required maxlength="80"></div>
      <div class="f"><label for="platform">Platform</label><select id="platform" name="platform">${platformOpts}</select></div>
      <div class="f"><label for="code">Kod</label>
        ${edit
          ? html`<input id="code" value="${v.code}" disabled><span class="hint">Kod değişmez; değişirse paylaşılmış linkler kırılır.</span>`
          : html`<input id="code" name="code" value="${v.code || ''}" placeholder="ayse-kaya" required maxlength="40" pattern="[a-z0-9](?:[a-z0-9\\-]{0,38}[a-z0-9])?" autocapitalize="off" autocomplete="off" spellcheck="false">
            <span class="hint">Küçük harf, rakam ve tire. Link: <b id="preview">${siteOrigin(env)}/i/${v.code || '…'}</b></span>`}
      </div>
      <div class="f"><label for="note">Not (kampanya / ürün)</label><textarea id="note" name="note" rows="2" maxlength="500" placeholder="Kasım C11 Pro kampanyası, barter">${v.note || ''}</textarea></div>
      <div class="f"><label for="target">Hedef</label><input id="target" name="target" value="${v.target || '/'}" list="targets" maxlength="1000" autocapitalize="off" spellcheck="false">
        <datalist id="targets"><option value="/"><option value="/#h-products"><option value="/#h-stores">
          <option value="https://www.yasomi.com.tr/yasomi-c11-pro-16kpa-1800w-sicak-su-spreyli-buharli-temizleyici-hali-ve-koltuk-yikama-makinesi">
          <option value="https://www.trendyol.com/magaza/yasomi-m-109844"></datalist>
        <span class="hint"><b>/</b> bio sayfası. <b>/#bolum</b> sayfadaki bir bölüm. Tam URL (Trendyol ürün sayfası vb.) da olur: yine sayılır, çerez konur, oraya gider.</span></div>
      <div class="row"><button class="btn" type="submit">${edit ? 'Kaydet' : 'Linki oluştur'}</button>
        <a class="btn ghost" href="${edit ? `/admin/i/${v.code}` : '/admin'}">Vazgeç</a></div>
    </form>
    ${edit ? '' : raw(`<script>
    (function(){
      var n=document.getElementById('name'),c=document.getElementById('code'),pv=document.getElementById('preview'),touched=!!c.value;
      var base=${JSON.stringify(siteOrigin(env) + '/i/')};
      var map={'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u','â':'a','î':'i','û':'u'};
      function slug(s){return s.replace(/İ/g,'i').replace(/I/g,'ı').toLowerCase().replace(/[çğıöşüâîû]/g,function(x){return map[x]})
        .normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40).replace(/-+$/,'')}
      function upd(){pv.textContent=base+(c.value||'…')}
      n.addEventListener('input',function(){if(!touched){c.value=slug(n.value);upd()}});
      c.addEventListener('input',function(){touched=!!c.value;c.value=c.value.toLowerCase().replace(/[^a-z0-9-]/g,'');upd()});
    })();
    </script>`)}`;
}

function newLinkPage(env, v, error = '', status = 200) {
  return page({ title: 'Yeni link', nav: 'new', body: html`<h1>Yeni influencer linki</h1>${linkForm(env, v, { error })}` }, status);
}

function readLinkForm(form) {
  const platform = String(form.get('platform') || '');
  return {
    name: clip(String(form.get('name') || '').trim(), 80),
    platform: PLATFORMS.includes(platform) ? platform : 'Diğer',
    note: clip(String(form.get('note') || '').trim(), 500),
    targetRaw: String(form.get('target') || '').trim(),
  };
}

async function createLink(request, env) {
  const form = await request.formData();
  const v = readLinkForm(form);
  v.code = String(form.get('code') || '').trim().toLowerCase() || slugify(v.name);
  v.target = v.targetRaw || '/';
  if (!v.name) return newLinkPage(env, v, 'İsim gerekli.', 400);
  if (!isValidCode(v.code)) {
    const why = CHANNELS[v.code]
      ? `"${v.code}" kodu kanal linki için ayrılmış (${siteHost(env)}/${v.code} → ${trafficLabel(CHANNELS[v.code])}). Başka bir kod seç.`
      : RESERVED_CODES.has(v.code) ? `"${v.code}" kodu sistemde ayrılmış (admin, api, assets, i…). Başka bir kod seç.`
      : 'Kod geçersiz: küçük harf, rakam ve tire; tireyle başlayıp bitemez.';
    return newLinkPage(env, v, why, 400);
  }
  const target = normalizeTarget(v.targetRaw);
  if (!target) return newLinkPage(env, v, 'Hedef geçersiz: "/" ile başlayan yol ya da https:// ile başlayan adres olmalı.', 400);
  if (await db.getInfluencer(env.DB, v.code)) return newLinkPage(env, v, `"${v.code}" kodu zaten kullanımda. Başka bir kod seç.`, 409);
  await db.createInfluencer(env.DB, { code: v.code, name: v.name, platform: v.platform, note: v.note, target });
  return see(`/admin/i/${v.code}?yeni=1`);
}

function editPage(env, inf, { error = '', values = null } = {}, status = 200) {
  const v = values || inf;
  return page({ title: `${inf.name} · düzenle`, body: html`<h1>Düzenle: ${inf.name}</h1>${linkForm(env, { ...v, code: inf.code }, { edit: true, error })}` }, status);
}

async function saveEdit(request, env, inf) {
  const form = await request.formData();
  const v = readLinkForm(form);
  v.target = v.targetRaw || '/';
  if (!v.name) return editPage(env, inf, { error: 'İsim gerekli.', values: v }, 400);
  const target = normalizeTarget(v.targetRaw);
  if (!target) return editPage(env, inf, { error: 'Hedef geçersiz.', values: v }, 400);
  await db.updateInfluencer(env.DB, inf.code, { name: v.name, platform: v.platform, note: v.note, target });
  return see(`/admin/i/${inf.code}?ok=kayit`);
}

// ---------------------------------------------------------------- detay
const OK_MSG = { kayit: 'Değişiklikler kaydedildi.', satis: 'Satın alma eklendi.', silindi: 'Satın alma silindi.', pasif: 'Link pasifleştirildi: artık sayılmıyor, ziyaretçi ana sayfaya gidiyor.', aktif: 'Link yeniden aktif.' };

function shareTable(rows, labelFn, head, total) {
  if (!rows.length) return html`<p class="muted small">Henüz veri yok.</p>`;
  return html`<div class="tw"><table><thead><tr><th>${head}</th><th class="n">Adet</th><th class="n">Pay</th><th></th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${labelFn(r)}</td><td class="n">${fmtNum(r.n)}</td><td class="n">${pct(r.n, total)}</td>
      <td style="width:30%"><div class="bar"><i style="width:${total ? Math.round((r.n / total) * 100) : 0}%"></i></div></td></tr>`)}
  </tbody></table></div>`;
}

async function detailPage(env, inf, url) {
  const code = inf.code;
  const pageNo = Math.max(1, parseInt(url.searchParams.get('sayfa') || '1', 10) || 1);
  const [t, series, br, ev, landing] = await Promise.all([
    db.codeTotals(env.DB, code), db.dailySeries(env.DB, code, 90), db.breakdowns(env.DB, code), db.eventPage(env.DB, code, pageNo, PER_PAGE),
    db.codeViewCount(env.DB, code),
  ]);
  const link = linkFor(env, code);
  const ok = OK_MSG[url.searchParams.get('ok')];
  const err = url.searchParams.get('hata') === 'satis' ? 'Satın alma eklenemedi: tarih veya tutar geçersiz.' : '';
  const isNew = url.searchParams.get('yeni') === '1';
  const pages = Math.max(1, Math.ceil(ev.total / PER_PAGE));
  const sumN = (a) => a.reduce((s, r) => s + r.n, 0);
  const visitsTotal = sumN(br.devices);

  const evRows = ev.rows.map((e) => html`<tr>
      <td class="t">${fmtDateTime(e.ts)}</td>
      <td><span class="badge ${e.type}">${TYPE_LABELS[e.type]}</span></td>
      <td>${e.type === 'purchase' ? SOURCE_LABELS[e.source] || e.source || '' : e.type === 'click' && e.href ? html`<a href="${e.href}" target="_blank" rel="noopener noreferrer">${e.target}</a>` : e.target || ''}</td>
      <td>${DEVICE_LABELS[e.device] || e.device || ''}${e.browser ? html`<span class="sub">${e.browser}</span>` : ''}</td>
      <td>${[e.country, e.city].filter(Boolean).join(' / ')}</td>
      <td>${e.referer || ''}</td>
      <td class="n">${e.type === 'purchase' ? html`<b>${fmtTRY(e.amount)}</b>${e.currency && e.currency !== 'TRY' ? ' ' + e.currency : ''}${e.order_id ? html`<span class="sub">#${e.order_id}</span>` : ''}${e.note ? html`<span class="sub">${e.note}</span>` : ''}` : ''}</td>
      <td>${e.type === 'purchase' ? html`<form method="post" action="/admin/i/${code}/purchase/${e.id}/delete" data-confirm="Bu satın alma kaydı silinsin mi?"><button class="btn danger sm" type="submit">Sil</button></form>` : ''}</td>
    </tr>`);

  const pager = pages > 1 ? html`<div class="pager">
      ${pageNo > 1 ? html`<a class="btn ghost sm" href="?sayfa=${pageNo - 1}#olaylar">← Yeni</a>` : ''}
      <span class="small muted">Sayfa ${pageNo} / ${pages} · ${fmtNum(ev.total)} olay</span>
      ${pageNo < pages ? html`<a class="btn ghost sm" href="?sayfa=${pageNo + 1}#olaylar">Eski →</a>` : ''}</div>`
    : html`<p class="small muted" style="margin:10px 0 0">${fmtNum(ev.total)} olay</p>`;

  const sourceOpts = PURCHASE_SOURCES.map((s) => html`<option value="${s}">${SOURCE_LABELS[s]}</option>`);

  const body = html`
    ${isNew ? html`<div class="alert ok">Link hazır. Kopyalayıp influencer'a gönder:</div>` : ''}
    ${ok ? html`<div class="alert ok">${ok}</div>` : ''}
    ${err ? html`<div class="alert err">${err}</div>` : ''}
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <div style="min-width:0;flex:1 1 260px">
          <h1 style="margin:0 0 4px">${inf.name}</h1>
          <div class="row small" style="gap:6px"><span class="badge">${inf.platform || 'Diğer'}</span>
            ${inf.active ? html`<span class="badge purchase">Aktif</span>` : html`<span class="badge off">Pasif</span>`}
            <span class="muted">Oluşturma: ${fmtDateTime(inf.created_at)}</span></div>
          ${inf.note ? html`<p style="margin:8px 0 0">${inf.note}</p>` : ''}
          <p class="small muted" style="margin:6px 0 0;overflow-wrap:anywhere">Hedef: ${inf.target}</p>
        </div>
        <div class="row" style="gap:8px">
          <a class="btn ghost sm" href="/admin/i/${code}/edit">Düzenle</a>
          <form method="post" action="/admin/i/${code}/toggle" data-confirm="${inf.active ? 'Link pasifleştirilsin mi? Tıklayan ana sayfaya gider, sayılmaz.' : 'Link yeniden aktif edilsin mi?'}">
            <button class="btn ${inf.active ? 'danger' : 'ghost'} sm" type="submit">${inf.active ? 'Pasifleştir' : 'Aktifleştir'}</button></form>
        </div>
      </div>
      <div class="linkbox" style="margin-top:12px"><code>${link.replace(/^https?:\/\//, '')}</code><button class="btn sm" type="button" data-copy="${link}">Kopyala</button></div>
    </div>

    ${kpiRow(t)}
    <p class="small muted" style="margin:-6px 0 16px">CTR (tıklama / ziyaret): 7 gün ${pct(t.c7, t.v7)} · 30 gün ${pct(t.c30, t.v30)} · tümü ${pct(t.c, t.v)}.
      Son aktivite: ${t.last_ts ? fmtDateTime(t.last_ts) : '—'}<br>
      Sayfa görüntüleme (landing): <b>${fmtNum(landing.n)}</b> <span class="muted">(30 gün: ${fmtNum(landing.n30)}; bio sayfası ?ref=${code} ile açıldı)</span></p>

    <div class="card"><h2>Son <span class="d-i">90</span><span class="m-i">30</span> gün</h2>${chartBlock(series)}
      <details style="margin-top:12px" ${series.slice(0, 14).some((d) => d.v || d.c || d.p) ? raw('open') : ''}><summary class="small" style="cursor:pointer;font-weight:600">Günlük tablo</summary>
      <div class="tw scroll" style="margin-top:8px"><table><thead><tr><th>Tarih</th><th class="n">Ziyaret</th><th class="n">Tıklama</th><th class="n">Satış</th><th class="n">Ciro</th></tr></thead><tbody>
        ${series.map((d) => html`<tr class="${d.v || d.c || d.p ? '' : 'zero'}"><td>${fmtDay(d.day)}</td><td class="n">${fmtNum(d.v)}</td><td class="n">${fmtNum(d.c)}</td><td class="n">${fmtNum(d.p)}</td><td class="n">${fmtTRY(d.r)}</td></tr>`)}
      </tbody></table></div></details>
    </div>

    <div class="grid two">
      <div class="card"><h2>Tıklama hedefleri</h2>${shareTable(br.targets, (r) => r.k, 'Hedef', sumN(br.targets))}</div>
      <div class="card"><h2>Cihaz ve tarayıcı <span class="muted small">(ziyaret)</span></h2>
        ${shareTable(br.devices, (r) => DEVICE_LABELS[r.k] || r.k, 'Cihaz', visitsTotal)}
        <div style="height:12px"></div>
        ${shareTable(br.browsers, (r) => r.k, 'Tarayıcı', visitsTotal)}</div>
    </div>
    <div class="card"><h2>Konum <span class="muted small">(ziyaret)</span></h2>${shareTable(br.places, (r) => [r.country, r.city].filter(Boolean).join(' / '), 'Ülke / şehir', visitsTotal)}</div>

    <div class="card" id="satis"><h2>Satın alma ekle</h2>
      <p class="small muted" style="margin-top:-6px">Pazaryeri satışları otomatik izlenemez. Influencer'ın getirdiğini bildiğin satışı buradan elle gir.</p>
      <form method="post" action="/admin/i/${code}/purchase">
        <div class="grid two" style="gap:0 12px">
          <div class="f"><label for="pd">Tarih</label><input id="pd" type="date" name="date" value="${daysAgo(0)}" required></div>
          <div class="f"><label for="ps">Kaynak</label><select id="ps" name="source">${sourceOpts}</select></div>
          <div class="f"><label for="pa">Tutar (₺)</label><input id="pa" name="amount" inputmode="decimal" placeholder="5.999" required></div>
          <div class="f"><label for="po">Sipariş no / not</label><input id="po" name="order_id" maxlength="100" placeholder="isteğe bağlı"></div>
        </div>
        <button class="btn" type="submit">Satın alma ekle</button>
      </form>
    </div>

    <div class="card" id="olaylar">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Olay kaydı</h2><span class="spacer"></span><a class="btn ghost sm" href="/admin/i/${code}/export.csv">CSV indir (tümü)</a></div>
      ${ev.rows.length ? html`<div class="tw"><table class="stack"><thead><tr><th>Zaman</th><th>Tür</th><th>Hedef / kaynak</th><th>Cihaz</th><th>Konum</th><th>Referer</th><th class="n">Tutar</th><th></th></tr></thead>
        <tbody>${evRows}</tbody></table></div>${pager}` : html`<p class="muted small">Henüz olay yok. Link ilk tıklandığında burada görünür.</p>`}
    </div>`;
  return page({ title: inf.name, body });
}

async function addPurchase(request, env, inf) {
  const form = await request.formData();
  const day = String(form.get('date') || '');
  const amount = parseAmount(form.get('amount'));
  const source = PURCHASE_SOURCES.includes(String(form.get('source'))) ? String(form.get('source')) : 'diger';
  const orderRaw = clip(String(form.get('order_id') || '').trim(), 100);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(noonOfDay(day)) || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
    return see(`/admin/i/${inf.code}?hata=satis#satis`);
  }
  // Kısa ve boşluksuz değer sipariş no sayılır, diğeri not.
  const isOrder = orderRaw && /^[A-Za-z0-9#._\/-]{2,60}$/.test(orderRaw);
  await db.insertEvent(env.DB, {
    ts: noonOfDay(day), day, type: 'purchase', code: inf.code, target: source, amount, currency: 'TRY', source,
    order_id: isOrder ? orderRaw.replace(/^#/, '') : null, note: isOrder ? 'elle' : clip(['elle', orderRaw].filter(Boolean).join(' · '), 300),
  });
  return see(`/admin/i/${inf.code}?ok=satis#satis`);
}

// ---------------------------------------------------------------- CSV
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(env, inf) {
  const rows = await db.allEvents(env.DB, inf.code);
  const head = ['id', 'zaman_istanbul', 'gun', 'tur', 'hedef', 'href', 'cihaz', 'tarayici', 'ulke', 'sehir', 'referer', 'tutar', 'para_birimi', 'siparis_no', 'kaynak', 'not', 'ua'];
  const lines = [head.join(';')];
  for (const e of rows) {
    lines.push([e.id, fmtDateTime(e.ts), e.day, e.type, e.target, e.href, e.device, e.browser, e.country, e.city, e.referer,
      e.amount === null || e.amount === undefined ? '' : String(e.amount).replace('.', ','), e.currency, e.order_id, e.source, e.note, e.ua].map(csvCell).join(';'));
  }
  // BOM + ';' ayırıcı: Türkçe Excel doğrudan sütunlara böler.
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="isailetisim-${inf.code}-${dayOf(Date.now())}.csv"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

// ---------------------------------------------------------------- ayarlar
const NOVIEW_MAX_AGE = 365 * 86400;
const SETTINGS_OK = { sayma: 'Bu tarayıcıdan bio sayfası ziyaretlerin ve tıklamaların artık sayılmıyor (1 yıl).', say: 'Bu tarayıcı yeniden sayılıyor.' };

/** "Beni sayma" / "Tekrar say": ynoview çerezi (apex alan adı, Path=/, 1 yıl). Panel apex'te açıldığı için çerez de apex'e yazılır. */
async function setNoView(request) {
  const form = await request.formData();
  const on = String(form.get('mode') || '') === 'on';
  const cookie = on
    ? `${NOVIEW_COOKIE}=1; Max-Age=${NOVIEW_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`
    : `${NOVIEW_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return see(`/admin/settings?ok=${on ? 'sayma' : 'say'}#ben`, { 'set-cookie': cookie });
}

async function settingsPage(request, env, url) {
  const origin = siteOrigin(env);
  const excluded = parseCookies(request.headers.get('cookie'))[NOVIEW_COOKIE] === '1';
  const ok = SETTINGS_OK[url.searchParams.get('ok')];
  const { allPages, orderPage } = ticimaxSnippets(origin);
  const unknown = await db.recentUnknownHits(env.DB);
  const curl = `curl -X POST ${origin}/api/purchase \\
  -H 'Content-Type: application/json' \\
  -H 'X-Postback-Key: PURCHASE_KEY_DEGERI' \\
  -d '{"ref":"ayse-kaya","order_id":"100234","amount":5999,"currency":"TRY","source":"site","note":"test"}'`;
  const chan = Object.entries(CHANNELS).map(([short, src]) => {
    const l = `${origin}/${short}`;
    return html`<div class="linkbox"><b>${trafficLabel(src)}</b><code>${l.replace(/^https?:\/\//, '')}</code><button class="btn sm" type="button" data-copy="${l}">Kopyala</button></div>`;
  });
  const body = html`<h1>Ayarlar</h1>
    ${ok ? html`<div class="alert ok">${ok}</div>` : ''}
    <div class="card" id="kanallar"><h2>Bio linkleri (kanal başına)</h2>
      <p class="small">Her platformun bio'suna kendi linkini koy: Instagram bio'suna <b>${siteHost(env)}/ig</b>, TikTok'a <b>/tt</b> gibi.
      Link ziyaretçiyi bio sayfasına götürür ve ziyareti o kanala yazar. Bu linkler olmadan da Instagram, TikTok ve Facebook uygulamasından gelen ziyaret
      uygulama içi tarayıcıdan büyük ölçüde tanınır; ama uygulamalar çoğu zaman nereden geldiğini (referer) gizler ve kişi linki kopyalayıp Safari'de açarsa
      "Direkt" görünür. Etiketli link her durumda kesindir. Başka bir yer için <code>?s=</code> ile kendi etiketini de verebilirsin: <code>${siteHost(env)}/?s=kasim-cekilis</code>.</p>
      <div class="chan">${chan}</div>
    </div>
    <div class="card" id="ben"><h2>Kendi ziyaretlerim</h2>
      <p class="small">Bio sayfasını kendin açınca sayılmasın istiyorsan bu tarayıcıda <b>Beni sayma</b>'ya bas. 1 yıl geçerli, yalnız bu tarayıcı ve bu
      cihaz için. Instagram/TikTok uygulamasının kendi tarayıcısı ayrı bir tarayıcıdır; orada da saymasın istiyorsan paneli oradan açıp bir kez daha bas.</p>
      <p class="small">Durum: ${excluded ? html`<span class="badge purchase">Bu tarayıcı sayılmıyor</span>` : html`<span class="badge">Bu tarayıcı sayılıyor</span>`}</p>
      <div class="row">
        <form method="post" action="/admin/settings/noview"><input type="hidden" name="mode" value="on"><button class="btn${excluded ? ' ghost' : ''}" type="submit">Beni sayma</button></form>
        <form method="post" action="/admin/settings/noview"><input type="hidden" name="mode" value="off"><button class="btn ${excluded ? '' : 'ghost'}" type="submit">Tekrar say</button></form>
      </div>
    </div>
    <div class="card"><h2>Satın alma bildirimi (postback)</h2>
      <p>Uç nokta: <code>POST ${origin}/api/purchase</code><br>
      Başlık: <code>X-Postback-Key: &lt;PURCHASE_KEY&gt;</code> · Gövde (JSON): <code>{ref, order_id, amount, currency, source, note}</code></p>
      <p class="small muted">Aynı sipariş no + kaynak ikinci kez gelirse yok sayılır. ref bilinmiyorsa kayıt yine düşer ama influencer'a atanmaz ("ref'siz" sayılır).
      Not: tarayıcıdaki betikte bu anahtar sayfa kaynağında görünür; yalnız rastgele çöp isteği keser. Şüpheli satışı panelden silebilirsin.</p>
      <pre>${curl}</pre>
    </div>
    <div class="card"><h2>Ticimax: sipariş sonrası betik</h2>
      <p class="small">İki parça var. 1. parça her sayfada çalışır ve bio'dan gelen ziyaretçinin kodunu tarayıcıda 30 gün saklar.
      2. parça yalnız "sipariş tamamlandı" sayfasında çalışır ve satışı bu panele yollar. <b>PURCHASE_KEY_DEGERI</b> yerine kendi anahtarını yaz.</p>
      <pre>${allPages}</pre><pre>${orderPage}</pre>
    </div>
    <div class="card"><h2>Bilinmeyen kod denemeleri <span class="muted small">(son 30 gün)</span></h2>
      ${unknown.length ? html`<div class="tw"><table><thead><tr><th>Kod</th><th class="n">Adet</th><th>Son</th></tr></thead><tbody>
        ${unknown.map((u) => html`<tr><td>${u.code}</td><td class="n">${fmtNum(u.n)}</td><td>${fmtDateTime(u.last)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted small">Kayıt yok.</p>`}
    </div>
    <div class="card"><h2>Oturum</h2><form method="post" action="/admin/logout"><button class="btn danger" type="submit">Çıkış yap</button></form></div>`;
  return page({ title: 'Ayarlar', nav: 'settings', body });
}

// ---------------------------------------------------------------- bio sayfası ziyaretçileri
const RANGES = { 7: '7 gün', 30: '30 gün', 90: '90 gün', tumu: 'Tümü' };
const VIEW_PER_PAGE = 50; // telefonda 100 satırlık kayıt sayfayı çok uzatıyor

function parseRange(url) {
  let r = String(url.searchParams.get('range') || '30').toLowerCase();
  if (r === 'all') r = 'tumu';
  return RANGES[r] ? r : '30';
}

/** Seçili dönemin ilk günü (tümü: null) */
const rangeFrom = (r, now = Date.now()) => (r === 'tumu' ? null : daysAgo(Number(r) - 1, now));

function viewRows(rows) {
  return rows.map((e) => html`<tr>
    <td class="t">${fmtDateTime(e.ts)}</td>
    <td class="src">${trafficLabel(e.target)}</td>
    <td>${DEVICE_LABELS[e.device] || e.device || ''}${e.browser ? html`<span class="sub">${e.browser}</span>` : ''}</td>
    <td>${[e.country, e.city].filter(Boolean).join(' / ')}</td>
    <td>${e.referer || ''}</td>
    <td>${e.code ? html`<a href="/admin/i/${e.code}">${e.code}</a>` : ''}</td>
  </tr>`);
}

async function visitorsPage(env, url) {
  const now = Date.now();
  const range = parseRange(url);
  const from = rangeFrom(range, now);
  const pageNo = Math.max(1, parseInt(url.searchParams.get('sayfa') || '1', 10) || 1);

  // Günlük seri uzunluğu: seçili dönem; "tümü"nde ilk görüntülemeden bugüne (en çok 2 yıl)
  let days = range === 'tumu' ? 30 : Number(range);
  if (range === 'tumu') {
    const first = await db.firstViewDay(env.DB);
    if (first) days = Math.min(730, Math.max(1, Math.round((Date.parse(daysAgo(0, now)) - Date.parse(first)) / DAY_MS) + 1));
  }
  const froms = { today: daysAgo(0, now), d7: daysAgo(6, now), d30: daysAgo(29, now) };
  if (range === '90') froms.d90 = daysAgo(89, now);
  froms.all = null;
  const mainKey = range === 'tumu' ? 'all' : `d${range}`;
  const periods = [{ key: mainKey, label: RANGES[range] }, { key: 'today', label: 'Bugün' }, { key: 'd7', label: '7 gün' }, { key: 'd30', label: '30 gün' }, { key: 'all', label: 'Tümü' }]
    .filter((p, i, a) => a.findIndex((x) => x.key === p.key) === i);

  const [k, src, series, br, ev] = await Promise.all([
    db.viewKpis(env.DB, froms), db.sourceBreakdown(env.DB, from), db.viewDaily(env.DB, days, now), db.viewBreakdowns(env.DB, from), db.viewPage(env.DB, from, pageNo, VIEW_PER_PAGE),
  ]);
  const sel = k[mainKey];
  const pages = Math.max(1, Math.ceil(ev.total / VIEW_PER_PAGE));
  const q = (extra = '') => `?range=${range}${extra}`;
  const sumN = (a) => a.reduce((x, r) => x + r.n, 0);
  const devTotal = sumN(br.devices);

  const seg = html`<div class="seg">${Object.entries(RANGES).map(([key, label]) => html`<a href="?range=${key}" class="${key === range ? 'on' : ''}">${label}</a>`)}</div>`;
  const pager = pages > 1 ? html`<div class="pager">
      ${pageNo > 1 ? html`<a class="btn ghost sm" href="${q(`&sayfa=${pageNo - 1}`)}#kayit">← Yeni</a>` : ''}
      <span class="small muted">Sayfa ${pageNo} / ${pages} · ${fmtNum(ev.total)} ziyaret</span>
      ${pageNo < pages ? html`<a class="btn ghost sm" href="${q(`&sayfa=${pageNo + 1}`)}#kayit">Eski →</a>` : ''}</div>`
    : html`<p class="small muted" style="margin:10px 0 0">${fmtNum(ev.total)} ziyaret</p>`;

  const body = html`
    <div class="row" style="margin-bottom:12px"><h1 style="margin:0">Ziyaretçiler</h1><span class="spacer"></span>${seg}</div>
    <p class="small muted" style="margin:-4px 0 12px">Bio sayfasının (${siteHost(env)}) açılışları. Botlar, link önizlemeleri ve aynı kişinin 30 sn içindeki tekrarı sayılmaz.
      Tekil = farklı cihaz/ağ (IP özeti). Tıklama = sayfadan bir mağazaya geçiş.</p>
    ${viewKpiRow(k, periods, mainKey)}

    <div class="card"><h2>Gün gün <span class="muted small">(${RANGES[range]}${range === 'tumu' ? `: ${fmtNum(days)} gün` : ''})</span></h2>
      ${chartBlock(series)}
      <details style="margin-top:12px" ${series.slice(0, 14).some((d) => d.v || d.c) ? raw('open') : ''}><summary class="small" style="cursor:pointer;font-weight:600">Günlük tablo</summary>
      <div class="tw scroll" style="margin-top:8px"><table><thead><tr><th>Tarih</th><th class="n">Ziyaret</th><th class="n">Tekil</th><th class="n">Tıklama</th><th class="n">CTR</th></tr></thead><tbody>
        ${series.map((d) => html`<tr class="${d.v || d.c ? '' : 'zero'}"><td>${fmtDay(d.day)}</td><td class="n">${fmtNum(d.v)}</td><td class="n">${fmtNum(d.u)}</td><td class="n">${fmtNum(d.c)}</td><td class="n">${ctrText(d.c, d.v)}</td></tr>`)}
      </tbody></table></div></details>
    </div>

    <div class="card" id="kaynaklar"><h2>Nereden geliyorlar? <span class="muted small">(${RANGES[range]})</span></h2>
      ${sourceTable(src, sel.v)}
      <p class="small muted" style="margin:10px 0 0">Kaynak sırası: <code>?s=</code> etiketi (kanal linkleri /ig, /tt…) → influencer linki (?ref=) → geldiği site (referer)
        → uygulama içi tarayıcı → Direkt. Tıklama, aynı kişinin son 1 saatteki ziyaretinin kaynağına yazılır.</p>
      ${br.webs.length ? html`<details style="margin-top:10px"><summary class="small" style="cursor:pointer;font-weight:600">Diğer web siteleri (${br.webs.length})</summary>
        <div style="margin-top:8px">${shareTable(br.webs, (r) => trafficLabel(r.k), 'Site', sumN(br.webs))}</div></details>` : ''}
    </div>

    <div class="grid two">
      <div class="card"><h2>Cihaz ve tarayıcı</h2>
        ${shareTable(br.devices, (r) => DEVICE_LABELS[r.k] || r.k, 'Cihaz', devTotal)}
        <div style="height:12px"></div>
        ${shareTable(br.browsers, (r) => r.k, 'Tarayıcı', devTotal)}</div>
      <div class="card"><h2>Konum <span class="muted small">(ilk 15)</span></h2>${shareTable(br.places, (r) => [r.country, r.city].filter(Boolean).join(' / '), 'Ülke / şehir', devTotal)}</div>
    </div>

    <div class="card"><h2>Saate göre <span class="muted small">(İstanbul saati)</span></h2>${hourChart(br.hours)}</div>

    <div class="card" id="kayit">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Ziyaret kaydı</h2><span class="spacer"></span><a class="btn ghost sm" href="/admin/ziyaretciler/export.csv${q()}">CSV indir (${RANGES[range]})</a></div>
      ${ev.rows.length ? html`<div class="tw"><table class="stack"><thead><tr><th>Zaman</th><th>Kaynak</th><th>Cihaz</th><th>Konum</th><th>Referer</th><th>Ref kodu</th></tr></thead>
        <tbody>${viewRows(ev.rows)}</tbody></table></div>${pager}` : html`<p class="muted small">Bu dönemde ziyaret yok.</p>`}
    </div>`;
  return page({ title: 'Ziyaretçiler', nav: 'views', body });
}

async function exportViewsCsv(env, url) {
  const range = parseRange(url);
  const rows = await db.allViews(env.DB, rangeFrom(range));
  const head = ['id', 'zaman_istanbul', 'gun', 'kaynak', 'kaynak_adi', 'cihaz', 'tarayici', 'ulke', 'sehir', 'referer', 'ref_kodu', 'adres', 'ua'];
  const lines = [head.join(';')];
  for (const e of rows) {
    lines.push([e.id, fmtDateTime(e.ts), e.day, e.target, trafficLabel(e.target), e.device, e.browser, e.country, e.city, e.referer, e.code, e.href, e.ua].map(csvCell).join(';'));
  }
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="isailetisim-ziyaretciler-${range}-${dayOf(Date.now())}.csv"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
