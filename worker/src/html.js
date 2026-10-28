// HTML yardımcıları: kaçış, sayı biçimi, sayfa iskeleti, ortak CSS/JS.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Etiketli şablon: ${} içindeki her değer kaçışlanır; raw() ile işaretlenen ve diziler (raw parçalar) olduğu gibi girer. */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else out += esc(v);
    out += strings[i + 1];
  });
  return new Raw(out);
}

/** 12345.5 -> "12.345,5" ; tam sayılar ondalıksız */
export function fmtNum(n, maxFrac = 0) {
  n = Number(n) || 0;
  const neg = n < 0; n = Math.abs(n);
  const fixed = n.toFixed(maxFrac);
  let [int, frac] = fixed.split('.');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (frac) frac = frac.replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? ',' + frac : '');
}
export const fmtTRY = (n) => fmtNum(n, 2) + ' ₺';
export const pct = (a, b) => (b ? fmtNum((a / b) * 100, 1) + '%' : '–');

export const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X', 'Diğer'];
export const SOURCE_LABELS = { site: 'yasomi.com.tr', trendyol: 'Trendyol', hepsiburada: 'Hepsiburada', amazon: 'Amazon', pazarama: 'Pazarama', temu: 'Temu', diger: 'Diğer' };
export const DEVICE_LABELS = { mobile: 'Mobil', tablet: 'Tablet', desktop: 'Masaüstü' };
export const TYPE_LABELS = { visit: 'Ziyaret', click: 'Tıklama', purchase: 'Satın alma', view: 'Görüntüleme' };

const CSS = `
:root{--blue:#26B0DE;--btn:#157A9B;--btn-h:#0f6580;--text:#1F1F1F;--muted:#6B7378;--bg:#F6F8F9;--card:#fff;--line:#E3E8EB;--ok:#1E8E5A;--warn:#B4590B;--bad:#C0392B;--r:12px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
a{color:var(--btn)}
.top{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.top .in{max-width:1180px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{font-weight:700;color:var(--text);text-decoration:none;display:flex;align-items:center;gap:8px;white-space:nowrap}
.brand i{width:10px;height:10px;border-radius:50%;background:var(--blue);display:inline-block}
.nav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
.nav a{padding:7px 11px;border-radius:999px;text-decoration:none;color:var(--text);font-weight:600;font-size:14px}
.nav a.on{background:#E6F6FC;color:var(--btn)}
main{max-width:1180px;margin:0 auto;padding:18px 16px 60px}
h1{font-size:22px;margin:4px 0 14px}
h2{font-size:16px;margin:0 0 12px}
.card{background:var(--card);border-radius:var(--r);padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);border:1px solid var(--line);margin-bottom:16px;min-width:0}
.grid{display:grid;gap:12px}
.kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:14px;min-width:0}
.kpi .l{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.kpi .v{font-size:24px;font-weight:700;margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .s{font-size:12px;color:var(--muted)}
.kpi .s b{color:var(--text);font-weight:600}
.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--btn);color:#fff;border:0;border-radius:10px;padding:10px 16px;font:600 14px Montserrat,system-ui,sans-serif;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--btn-h)}
.btn.ghost{background:#fff;color:var(--btn);border:1px solid #BFE3F0}
.btn.ghost:hover{background:#F0F9FC}
.btn.danger{background:#fff;color:var(--bad);border:1px solid #F0C9C4}
.btn.sm{padding:6px 10px;font-size:13px;border-radius:8px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.spacer{flex:1}
.muted{color:var(--muted)}
.small{font-size:13px}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px;padding:0 16px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em;background:#FAFBFC;position:sticky;top:0}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr.zero td{color:#A7B0B5}
th.sort{cursor:pointer;user-select:none}
th.sort:after{content:" ↕";opacity:.35}
th.sort.asc:after{content:" ↑";opacity:1}
th.sort.desc:after{content:" ↓";opacity:1}
.scroll{max-height:440px;overflow:auto}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#E6F6FC;color:var(--btn)}
.badge.off{background:#F1F1F1;color:#888}
.badge.visit{background:#E6F6FC;color:#157A9B}
.badge.click{background:#EEF0FF;color:#4651B8}
.badge.purchase{background:#E5F6EE;color:var(--ok)}
.badge.view{background:#FFF4E5;color:var(--warn)}
.seg a{display:inline-block;padding:6px 12px;border-radius:999px;font:600 13px Montserrat,system-ui,sans-serif;color:var(--muted);text-decoration:none}
.seg a.on{background:#fff;color:var(--btn);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.sec{font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:4px 0 8px}
.hours{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:3px;align-items:end;height:120px}
.hours>div{display:flex;flex-direction:column;align-items:center;height:100%;min-width:0}
.hours .b{flex:1;width:100%;display:flex;align-items:flex-end}
.hours i{display:block;width:100%;background:var(--blue);border-radius:3px 3px 0 0;min-height:2px}
.hours i.z{background:#E3E8EB}
.hours span{font-size:10px;color:var(--muted);margin-top:4px;line-height:1}
.chan{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.chan .linkbox b{font-size:13px;min-width:74px}
td.src{font-weight:600}
.pi{white-space:nowrap}
.sec .dom{text-transform:none;letter-spacing:.02em}
.linkbox{display:flex;gap:8px;align-items:center;background:#F0F9FC;border:1px solid #CDEBF5;border-radius:10px;padding:8px 8px 8px 12px;min-width:0;max-width:100%}
.linkbox code{font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
form .f{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;min-width:0}
label{font-size:13px;font-weight:600}
input,select,textarea{font:15px Montserrat,system-ui,sans-serif;padding:10px 12px;border:1px solid #CBD3D8;border-radius:10px;background:#fff;color:var(--text);width:100%;min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid var(--blue);outline-offset:0;border-color:var(--blue)}
.hint{font-size:12px;color:var(--muted)}
.alert{padding:12px 14px;border-radius:10px;margin-bottom:14px;font-weight:600}
.alert.ok{background:#E5F6EE;color:#155E3D}
.alert.err{background:#FDECEA;color:#8E2A1F}
.seg{display:inline-flex;background:#EEF2F4;border-radius:999px;padding:3px}
.seg button{border:0;background:transparent;padding:6px 12px;border-radius:999px;font:600 13px Montserrat,system-ui,sans-serif;color:var(--muted);cursor:pointer}
.seg button.on{background:#fff;color:var(--btn);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.bar{height:8px;background:#E6F6FC;border-radius:4px;overflow:hidden;min-width:60px}
.bar i{display:block;height:100%;background:var(--blue)}
.chart svg{display:block;width:100%;height:auto}
.chart svg.m,.m-i{display:none}
.sub{display:block;color:var(--muted);font-size:12px}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:6px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.pager{display:flex;gap:6px;align-items:center;margin-top:12px;flex-wrap:wrap}
.login{max-width:360px;margin:12vh auto 0}
pre{background:#0F2730;color:#DDF3FA;padding:14px;border-radius:10px;overflow:auto;font-size:12.5px;line-height:1.5;max-width:100%}
.nm{font-weight:700;text-decoration:none;color:var(--btn)}
.nm:hover{text-decoration:underline}
#inf td:first-child,#inf th:first-child{position:sticky;left:0;z-index:1;white-space:normal;min-width:130px;max-width:220px}
#inf td:first-child{background:#fff}
.nm small{display:block;font-weight:500;color:var(--muted);font-size:12px}
@media (max-width:860px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.three{grid-template-columns:1fr}}
@media (max-width:640px){.chan{grid-template-columns:1fr}.hm{display:none}.srct td.src{white-space:normal;min-width:96px}.hours span{visibility:hidden}.hours>div:nth-child(3n+1) span{visibility:visible}.chart svg.d,.d-i{display:none}.chart svg.m{display:block}.m-i{display:inline}
th,td{padding:7px 6px;font-size:13px}th{font-size:11px}
.linkbox code{white-space:normal;overflow-wrap:anywhere;font-size:13px}
table.stack thead{display:none}table.stack,table.stack tbody{display:block}
table.stack tr{display:flex;flex-wrap:wrap;align-items:center;gap:3px 10px;padding:10px 0;border-bottom:1px solid var(--line)}
table.stack td{display:block;border:0;padding:0;white-space:normal}
table.stack td:empty{display:none}
table.stack td.n{text-align:left}
table.stack td.t{font-weight:600;font-size:13px}
table.stack .sub{display:inline;margin-left:4px}
.two{grid-template-columns:1fr}h1{font-size:19px}.kpi .v{font-size:20px}main{padding:14px 12px 50px}.card{padding:14px}.tw{margin:0 -14px;padding:0 14px}.top .in{padding:8px 12px;gap:8px}.nav{margin-left:0;width:100%}.nav a{padding:6px 10px;font-size:13px}}
`;

const JS = `
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-copy]');if(!b)return;
  var t=b.getAttribute('data-copy');
  var done=function(){var o=b.textContent;b.textContent='Kopyalandı ✓';setTimeout(function(){b.textContent=o},1400)};
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(done,function(){fallback()})}else fallback();
  function fallback(){var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy');done()}catch(_){prompt('Kopyala:',t)}a.remove()}
});
document.addEventListener('submit',function(e){var m=e.target.getAttribute('data-confirm');if(m&&!confirm(m))e.preventDefault()});
`;

export function layout({ title, body, nav = '', loggedIn = true }) {
  const link = (href, key, label) => html`<a href="${href}" class="${nav === key ? 'on' : ''}">${label}</a>`;
  const top = loggedIn
    ? html`<header class="top"><div class="in"><a class="brand" href="/admin"><i></i>Yasomi · Influencer</a>
        <nav class="nav">${[link('/admin', 'home', 'Genel bakış'), link('/admin/ziyaretciler', 'views', 'Ziyaretçiler'), link('/admin/new', 'new', 'Yeni link'), link('/admin/settings', 'settings', 'Ayarlar')]}</nav></div></header>`
    : raw('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Yasomi Influencer</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap">
<style>${CSS}</style></head><body>${top}<main>${body}</main><script>${JS}</script></body></html>`;
}

export function page(opts, status = 200, headers = {}) {
  return new Response(layout(opts), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      ...headers,
    },
  });
}

/** KPI kutusu: büyük sayı 30 gün, altında 7 gün ve tüm zamanlar */
export function kpiTile(label, v7, v30, vAll, fmt = fmtNum) {
  return html`<div class="kpi"><div class="l">${label}</div><div class="v" title="Son 30 gün">${fmt(v30)}</div>
    <div class="s">30 gün · 7 gün: <b>${fmt(v7)}</b> · Tümü: <b>${fmt(vAll)}</b></div></div>`;
}

/**
 * Dönemli KPI kutusu: büyük sayı `main` dönemi, altında diğer dönemler.
 * periods: [{ key, label, value }]
 */
export function periodTile(label, periods, main, fmt = fmtNum) {
  const big = periods.find((p) => p.key === main) || periods[0];
  const rest = periods.filter((p) => p !== big);
  return html`<div class="kpi"><div class="l">${label}</div><div class="v" title="${big.label}">${fmt(big.value)}</div>
    <div class="s"><span class="pi">${big.label}</span>${rest.map((p) => html` · <span class="pi">${p.label}: <b>${fmt(p.value)}</b></span>`)}</div></div>`;
}

/** Bio sayfası KPI satırı. k: { anahtar: {v,u,c} }, periods: [{key,label}] */
export function viewKpiRow(k, periods, main) {
  const per = (f) => periods.map((p) => ({ key: p.key, label: p.label, value: f(k[p.key]) }));
  const rate = (x) => (x.v ? (x.c / x.v) * 100 : null);
  const fmtRate = (x) => (x === null ? '–' : fmtNum(x, 1) + '%');
  return html`<div class="grid kpis">
    ${periodTile('Ziyaret', per((x) => x.v), main)}
    ${periodTile('Tekil ziyaretçi', per((x) => x.u), main)}
    ${periodTile('Tıklama', per((x) => x.c), main)}
    ${periodTile('Tıklama oranı', per(rate), main, fmtRate)}
  </div>`;
}

/** 24 saatlik histogram (İstanbul saati); hours: 24 elemanlı dizi */
export function hourChart(hours) {
  const max = Math.max(1, ...hours);
  return html`<div class="hours" role="img" aria-label="Saate göre ziyaret">${hours.map((n, h) => html`<div title="${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 · ${fmtNum(n)} ziyaret"><div class="b"><i class="${n ? '' : 'z'}" style="height:${n ? Math.max(3, Math.round((n / max) * 100)) : 2}%"></i></div><span>${h}</span></div>`)}</div>`;
}

export function kpiRow(t) {
  return html`<div class="grid kpis">
    ${kpiTile('Ziyaret', t.v7, t.v30, t.v)}
    ${kpiTile('Tıklama', t.c7, t.c30, t.c)}
    ${kpiTile('Satın alma', t.p7, t.p30, t.p)}
    ${kpiTile('Ciro', t.r7, t.r30, t.r, fmtTRY)}
  </div>`;
}

/** 90 günlük ziyaret/tıklama sütun grafiği (satır içi SVG, kütüphanesiz). series en yeni önce gelir. */
export function barChart(series, { W = 900, H = 180, cls = '' } = {}) {
  const data = [...series].reverse(); // soldan sağa eski -> yeni
  const padL = 34, padB = 22, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.v, d.c)));
  const nice = niceMax(max);
  const plotW = W - padL - 4, plotH = H - padB - padT;
  const step = plotW / data.length;
  const bw = Math.max(1.5, step * 0.78);
  const y = (val) => padT + plotH - (val / nice) * plotH;
  let bars = '';
  data.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const tip = `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}: ${d.v} ziyaret, ${d.c} tıklama`;
    bars += `<g><title>${esc(tip)}</title>`;
    if (d.v) bars += `<rect x="${x.toFixed(1)}" y="${y(d.v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT + plotH - y(d.v)).toFixed(1)}" fill="#9ADAF0" rx="1"/>`;
    if (d.c) { const cw = bw * 0.5; bars += `<rect x="${(x + (bw - cw) / 2).toFixed(1)}" y="${y(d.c).toFixed(1)}" width="${cw.toFixed(1)}" height="${(padT + plotH - y(d.c)).toFixed(1)}" fill="#157A9B" rx="1"/>`; }
    bars += `<rect x="${(padL + i * step).toFixed(1)}" y="${padT}" width="${step.toFixed(1)}" height="${plotH}" fill="transparent"/></g>`;
  });
  let grid = '';
  for (const f of [0, 0.5, 1]) {
    const val = nice * f, yy = y(val).toFixed(1);
    grid += `<line x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}" stroke="#E3E8EB" stroke-width="1"/><text x="${padL - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6B7378">${fmtNum(val, 1)}</text>`;
  }
  let labels = '';
  for (const i of [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1]) {
    const d = data[i]; if (!d) continue;
    const anchor = i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle';
    const x = i === 0 ? padL : i === data.length - 1 ? W : padL + i * step + step / 2;
    labels += `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}" font-size="11" fill="#6B7378">${d.day.slice(8, 10)}.${d.day.slice(5, 7)}</text>`;
  }
  return raw(`<svg class="${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Son ${data.length} gün ziyaret ve tıklama">${grid}${bars}${labels}</svg>`);
}

/** Masaüstünde 90 gün, telefonda 30 gün (yazılar okunur kalsın diye ayrı SVG). */
export function chartBlock(series) {
  return html`<div class="chart">${barChart(series, { cls: 'd' })}${barChart(series.slice(0, 30), { W: 360, H: 170, cls: 'm' })}
    <div class="legend"><span><i style="background:#9ADAF0"></i>Ziyaret</span><span><i style="background:#157A9B"></i>Tıklama</span></div></div>`;
}

function niceMax(m) {
  if (m <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= m) return k * p;
  return 10 * p;
}
