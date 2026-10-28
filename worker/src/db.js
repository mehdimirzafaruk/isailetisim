// D1 erişimi: tüm SQL burada.
import { daysAgo } from './util.js';

export async function getInfluencer(db, code) {
  return db.prepare('SELECT * FROM influencers WHERE code = ?').bind(code).first();
}

export async function createInfluencer(db, { code, name, platform, note, target }) {
  await db.prepare('INSERT INTO influencers (code, name, platform, note, target, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .bind(code, name, platform, note, target, Date.now()).run();
}

export async function updateInfluencer(db, code, { name, platform, note, target }) {
  await db.prepare('UPDATE influencers SET name = ?, platform = ?, note = ?, target = ? WHERE code = ?')
    .bind(name, platform, note, target, code).run();
}

export async function setActive(db, code, active) {
  await db.prepare('UPDATE influencers SET active = ? WHERE code = ?').bind(active ? 1 : 0, code).run();
}

const EV_COLS = ['ts', 'day', 'type', 'code', 'target', 'href', 'device', 'browser', 'ua', 'country', 'city', 'referer', 'ip_hash', 'amount', 'currency', 'order_id', 'source', 'note'];
const evValues = (ev) => EV_COLS.map((c) => (ev[c] === undefined ? null : ev[c]));

export async function insertEvent(db, ev) {
  const r = await db.prepare(`INSERT INTO events (${EV_COLS.join(',')}) VALUES (${EV_COLS.map(() => '?').join(',')})`)
    .bind(...evValues(ev)).run();
  return r.meta?.last_row_id;
}

/**
 * Tekilleştirerek ekle: aynı (code, ip_hash) için `windowMs` içinde aynı türde (click'te aynı target) olay varsa eklemez.
 * Tek ifade: INSERT ... SELECT ... WHERE NOT EXISTS. Dönen: eklendiyse true.
 */
export async function insertEventDedup(db, ev, windowMs, { byCode = true } = {}) {
  const extra = ev.type === 'click' ? ' AND target IS ?' : '';
  const codeCond = byCode ? ' AND code IS ?' : '';
  const sql = `INSERT INTO events (${EV_COLS.join(',')}) SELECT ${EV_COLS.map(() => '?').join(',')}
    WHERE NOT EXISTS (SELECT 1 FROM events WHERE type = ?${codeCond} AND ip_hash = ? AND ts > ?${extra})`;
  const binds = [...evValues(ev), ev.type, ...(byCode ? [ev.code ?? null] : []), ev.ip_hash, ev.ts - windowMs];
  if (ev.type === 'click') binds.push(ev.target ?? null);
  const r = await db.prepare(sql).bind(...binds).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function purchaseExists(db, orderId, source) {
  const r = await db.prepare("SELECT id FROM events WHERE type = 'purchase' AND order_id = ? AND source IS ? LIMIT 1").bind(orderId, source ?? null).first();
  return !!r;
}

export async function deletePurchase(db, code, id) {
  const r = await db.prepare("DELETE FROM events WHERE id = ? AND code = ? AND type = 'purchase'").bind(id, code).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function logUnknownHit(db, code) {
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO unknown_hits (code, ts) VALUES (?, ?)').bind(String(code).slice(0, 60), now),
    db.prepare('DELETE FROM unknown_hits WHERE ts < ?').bind(now - 30 * 86400e3),
  ]);
}

export async function recentUnknownHits(db) {
  const r = await db.prepare('SELECT code, COUNT(*) AS n, MAX(ts) AS last FROM unknown_hits GROUP BY code ORDER BY last DESC LIMIT 20').all();
  return r.results || [];
}

// ---------- giriş denemeleri ----------
export async function countLoginAttempts(db, ipHash, sinceTs) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND ts > ?').bind(ipHash, sinceTs).first();
  return r?.n || 0;
}
export async function addLoginAttempt(db, ipHash) {
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO login_attempts (ip_hash, ts) VALUES (?, ?)').bind(ipHash, now),
    db.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(now - 86400e3),
  ]);
}
export async function clearLoginAttempts(db, ipHash) {
  await db.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(ipHash).run();
}

// ---------- istatistik ----------
// 7 gün = bugün + önceki 6 gün (İstanbul günleri).
export function periodDays(now = Date.now()) {
  return { d7: daysAgo(6, now), d30: daysAgo(29, now), today: daysAgo(0, now) };
}

const AGG = `
  COALESCE(SUM(e.type = 'visit'    AND e.day >= ?1), 0) AS v7,
  COALESCE(SUM(e.type = 'click'    AND e.day >= ?1), 0) AS c7,
  COALESCE(SUM(e.type = 'purchase' AND e.day >= ?1), 0) AS p7,
  COALESCE(SUM(CASE WHEN e.type = 'purchase' AND e.day >= ?1 THEN e.amount END), 0) AS r7,
  COALESCE(SUM(e.type = 'visit'    AND e.day >= ?2), 0) AS v30,
  COALESCE(SUM(e.type = 'click'    AND e.day >= ?2), 0) AS c30,
  COALESCE(SUM(e.type = 'purchase' AND e.day >= ?2), 0) AS p30,
  COALESCE(SUM(CASE WHEN e.type = 'purchase' AND e.day >= ?2 THEN e.amount END), 0) AS r30,
  COALESCE(SUM(e.type = 'visit'), 0) AS v,
  COALESCE(SUM(e.type = 'click'), 0) AS c,
  COALESCE(SUM(e.type = 'purchase'), 0) AS p,
  COALESCE(SUM(CASE WHEN e.type = 'purchase' THEN e.amount END), 0) AS r,
  MAX(e.ts) AS last_ts`;

/** Tüm influencer'lar + dönem toplamları */
export async function influencerStats(db, now = Date.now()) {
  const { d7, d30 } = periodDays(now);
  const r = await db.prepare(`SELECT i.*, ${AGG} FROM influencers i LEFT JOIN events e ON e.code = i.code AND e.type != 'view'
    GROUP BY i.id ORDER BY i.active DESC, i.created_at DESC`).bind(d7, d30).all();
  return r.results || [];
}

/** Genel toplam (yalnız influencer'a atanmış olaylar) ve ref'siz olaylar */
export async function totals(db, now = Date.now()) {
  const { d7, d30 } = periodDays(now);
  const [att, organic] = await db.batch([
    db.prepare(`SELECT ${AGG} FROM events e WHERE e.code IS NOT NULL`).bind(d7, d30),
    db.prepare(`SELECT ${AGG} FROM events e WHERE e.code IS NULL`).bind(d7, d30),
  ]);
  return { att: att.results[0], organic: organic.results[0] };
}

export async function codeTotals(db, code, now = Date.now()) {
  const { d7, d30 } = periodDays(now);
  return db.prepare(`SELECT ${AGG} FROM events e WHERE e.code = ?3 AND e.type != 'view'`).bind(d7, d30, code).first();
}

/** Son `days` gün, sıfır günler dahil, en yeni önce */
export async function dailySeries(db, code, days = 90, now = Date.now()) {
  const from = daysAgo(days - 1, now);
  const r = await db.prepare(`SELECT day,
      SUM(type = 'visit') AS v, SUM(type = 'click') AS c, SUM(type = 'purchase') AS p,
      COALESCE(SUM(CASE WHEN type = 'purchase' THEN amount END), 0) AS r
    FROM events WHERE code = ? AND day >= ? GROUP BY day`).bind(code, from).all();
  const map = new Map((r.results || []).map((x) => [x.day, x]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = daysAgo(i, now);
    const x = map.get(day);
    out.push({ day, v: x?.v || 0, c: x?.c || 0, p: x?.p || 0, r: x?.r || 0 });
  }
  return out;
}

export async function breakdowns(db, code) {
  const [targets, devices, browsers, places] = await db.batch([
    db.prepare("SELECT COALESCE(target, '?') AS k, COUNT(*) AS n FROM events WHERE code = ? AND type = 'click' GROUP BY k ORDER BY n DESC").bind(code),
    db.prepare("SELECT COALESCE(device, '?') AS k, COUNT(*) AS n FROM events WHERE code = ? AND type = 'visit' GROUP BY k ORDER BY n DESC").bind(code),
    db.prepare("SELECT COALESCE(browser, '?') AS k, COUNT(*) AS n FROM events WHERE code = ? AND type = 'visit' GROUP BY k ORDER BY n DESC").bind(code),
    db.prepare("SELECT COALESCE(country, '?') AS country, city, COUNT(*) AS n FROM events WHERE code = ? AND type = 'visit' GROUP BY country, city ORDER BY n DESC LIMIT 25").bind(code),
  ]);
  return { targets: targets.results, devices: devices.results, browsers: browsers.results, places: places.results };
}

export async function eventPage(db, code, page = 1, perPage = 100) {
  const [rows, cnt] = await db.batch([
    db.prepare("SELECT * FROM events WHERE code = ? AND type != 'view' ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?").bind(code, perPage, (page - 1) * perPage),
    db.prepare("SELECT COUNT(*) AS n FROM events WHERE code = ? AND type != 'view'").bind(code),
  ]);
  return { rows: rows.results || [], total: cnt.results[0]?.n || 0 };
}

export async function allEvents(db, code) {
  const r = await db.prepare("SELECT * FROM events WHERE code = ? AND type != 'view' ORDER BY ts DESC, id DESC").bind(code).all();
  return r.results || [];
}

/** Influencer'ın bio sayfasına iniş görüntülemesi (view, ?ref=kod) */
export async function codeViewCount(db, code, now = Date.now()) {
  const r = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(day >= ?2), 0) AS n30 FROM events WHERE type = 'view' AND code = ?1")
    .bind(code, daysAgo(29, now)).first();
  return { n: r?.n || 0, n30: r?.n30 || 0 };
}

// ---------- bio sayfası ziyaretçileri (view) ----------
// Tıklamanın kaynağı: aynı ip_hash'in tıklamadan önceki son 1 saatteki en yeni görüntülemesi.
export const CLICK_ATTRIB_MS = 3600 * 1000;
const NO_FROM = '0000-00-00';
const GROUP = "CASE WHEN target LIKE 'web:%' THEN 'web' ELSE COALESCE(target, 'direkt') END";
const CLICK_SRC = `(SELECT CASE WHEN x.target LIKE 'web:%' THEN 'web' ELSE COALESCE(x.target, 'direkt') END FROM events x
  WHERE x.type = 'view' AND x.ip_hash = e.ip_hash AND x.ts <= e.ts AND x.ts > e.ts - ${CLICK_ATTRIB_MS} ORDER BY x.ts DESC LIMIT 1)`;

/**
 * Görüntüleme / tekil / tıklama toplamları. froms: { anahtar: 'YYYY-MM-DD' | null } (null = tüm zamanlar).
 * Dönen: { anahtar: { v, u, c } }
 */
export async function viewKpis(db, froms) {
  const keys = Object.keys(froms);
  const binds = keys.map((k) => froms[k] || NO_FROM);
  const cols = keys.map((k, i) => `COALESCE(SUM(type = 'view' AND day >= ?${i + 1}), 0) AS v_${i},
    COUNT(DISTINCT CASE WHEN type = 'view' AND day >= ?${i + 1} THEN ip_hash END) AS u_${i},
    COALESCE(SUM(type = 'click' AND day >= ?${i + 1}), 0) AS c_${i}`).join(',\n');
  const r = await db.prepare(`SELECT ${cols} FROM events WHERE type IN ('view', 'click')`).bind(...binds).first();
  const out = {};
  keys.forEach((k, i) => { out[k] = { v: r?.[`v_${i}`] || 0, u: r?.[`u_${i}`] || 0, c: r?.[`c_${i}`] || 0 }; });
  return out;
}

/** Kaynak kırılımı (web:* tek satır 'web'): [{ k, v, u, c }] görüntülemeye göre azalan */
export async function sourceBreakdown(db, from) {
  const r = await db.prepare(`SELECT k, SUM(v) AS v, SUM(u) AS u, SUM(c) AS c FROM (
      SELECT ${GROUP} AS k, COUNT(*) AS v, COUNT(DISTINCT ip_hash) AS u, 0 AS c FROM events WHERE type = 'view' AND day >= ?1 GROUP BY k
      UNION ALL
      SELECT COALESCE(src, '?') AS k, 0, 0, COUNT(*) FROM (SELECT ${CLICK_SRC} AS src FROM events e WHERE e.type = 'click' AND e.day >= ?1) GROUP BY k
    ) GROUP BY k ORDER BY v DESC, c DESC, k`).bind(from || NO_FROM).all();
  return r.results || [];
}

/** Gün gün görüntüleme / tekil / tıklama; `days` gün, sıfır günler dahil, en yeni önce */
export async function viewDaily(db, days, now = Date.now()) {
  const from = daysAgo(days - 1, now);
  const r = await db.prepare(`SELECT day, SUM(type = 'view') AS v, COUNT(DISTINCT CASE WHEN type = 'view' THEN ip_hash END) AS u,
      SUM(type = 'click') AS c FROM events WHERE type IN ('view', 'click') AND day >= ? GROUP BY day`).bind(from).all();
  const map = new Map((r.results || []).map((x) => [x.day, x]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = daysAgo(i, now);
    const x = map.get(day);
    out.push({ day, v: x?.v || 0, u: x?.u || 0, c: x?.c || 0, p: 0, r: 0 });
  }
  return out;
}

export async function firstViewDay(db) {
  const r = await db.prepare("SELECT MIN(day) AS d FROM events WHERE type = 'view'").first();
  return r?.d || null;
}

/** Cihaz, tarayıcı, konum (ilk 15), saat (İstanbul) ve diğer web siteleri kırılımları */
export async function viewBreakdowns(db, from) {
  const f = from || NO_FROM;
  const W = "FROM events WHERE type = 'view' AND day >= ?";
  const [devices, browsers, places, hours, webs] = await db.batch([
    db.prepare(`SELECT COALESCE(device, '?') AS k, COUNT(*) AS n ${W} GROUP BY k ORDER BY n DESC`).bind(f),
    db.prepare(`SELECT COALESCE(browser, '?') AS k, COUNT(*) AS n ${W} GROUP BY k ORDER BY n DESC`).bind(f),
    db.prepare(`SELECT COALESCE(country, '?') AS country, city, COUNT(*) AS n ${W} GROUP BY country, city ORDER BY n DESC LIMIT 15`).bind(f),
    db.prepare(`SELECT ((ts + 10800000) / 3600000) % 24 AS h, COUNT(*) AS n ${W} GROUP BY h`).bind(f),
    db.prepare(`SELECT target AS k, COUNT(*) AS n ${W} AND target LIKE 'web:%' GROUP BY k ORDER BY n DESC LIMIT 15`).bind(f),
  ]);
  const hourArr = Array(24).fill(0);
  for (const x of hours.results || []) hourArr[Number(x.h)] = x.n;
  return { devices: devices.results, browsers: browsers.results, places: places.results, hours: hourArr, webs: webs.results };
}

export async function viewPage(db, from, page = 1, perPage = 100) {
  const f = from || NO_FROM;
  const [rows, cnt] = await db.batch([
    db.prepare("SELECT * FROM events WHERE type = 'view' AND day >= ? ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?").bind(f, perPage, (page - 1) * perPage),
    db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'view' AND day >= ?").bind(f),
  ]);
  return { rows: rows.results || [], total: cnt.results[0]?.n || 0 };
}

export async function allViews(db, from) {
  const r = await db.prepare("SELECT * FROM events WHERE type = 'view' AND day >= ? ORDER BY ts DESC, id DESC").bind(from || NO_FROM).all();
  return r.results || [];
}

// ---------- şifre kasası ----------
// password_enc / note_enc şifreli metindir; çözme src/vault.js'te. Liste sorgusu şifreli alanları hiç döndürmez.
const VAULT_COLS = ['title', 'url', 'username', 'email', 'phone', 'category', 'password_enc', 'note_enc'];

export async function listVaultEntries(db) {
  const r = await db.prepare(`SELECT uid, title, url, username, email, phone, category,
      password_enc IS NOT NULL AS has_pw, note_enc IS NOT NULL AS has_note, created_at, updated_at FROM vault_entries`).all();
  return r.results || [];
}

export async function getVaultEntry(db, uid) {
  return db.prepare('SELECT * FROM vault_entries WHERE uid = ?').bind(uid).first();
}

export async function allVaultEntries(db) {
  const r = await db.prepare('SELECT * FROM vault_entries').all();
  return r.results || [];
}

export async function createVaultEntry(db, uid, e) {
  const now = Date.now();
  await db.prepare(`INSERT INTO vault_entries (uid, ${VAULT_COLS.join(', ')}, created_at, updated_at) VALUES (?, ${VAULT_COLS.map(() => '?').join(', ')}, ?, ?)`)
    .bind(uid, ...VAULT_COLS.map((c) => e[c] ?? null), now, now).run();
}

export async function updateVaultEntry(db, uid, e) {
  await db.prepare(`UPDATE vault_entries SET ${VAULT_COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE uid = ?`)
    .bind(...VAULT_COLS.map((c) => e[c] ?? null), Date.now(), uid).run();
}

export async function deleteVaultEntry(db, uid) {
  const r = await db.prepare('DELETE FROM vault_entries WHERE uid = ?').bind(uid).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function addVaultAudit(db, { action, entry_uid = null, title = null, ip_hash = null }) {
  await db.prepare('INSERT INTO vault_audit (ts, action, entry_uid, title, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), action, entry_uid, title, ip_hash).run();
}

export async function recentVaultAudit(db, limit = 15) {
  const r = await db.prepare('SELECT * FROM vault_audit ORDER BY ts DESC, id DESC LIMIT ?').bind(limit).all();
  return r.results || [];
}
