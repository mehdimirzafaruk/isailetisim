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
export async function insertEventDedup(db, ev, windowMs) {
  const extra = ev.type === 'click' ? ' AND target IS ?' : '';
  const sql = `INSERT INTO events (${EV_COLS.join(',')}) SELECT ${EV_COLS.map(() => '?').join(',')}
    WHERE NOT EXISTS (SELECT 1 FROM events WHERE type = ? AND code IS ? AND ip_hash = ? AND ts > ?${extra})`;
  const binds = [...evValues(ev), ev.type, ev.code ?? null, ev.ip_hash, ev.ts - windowMs];
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
  const r = await db.prepare(`SELECT i.*, ${AGG} FROM influencers i LEFT JOIN events e ON e.code = i.code
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
  return db.prepare(`SELECT ${AGG} FROM events e WHERE e.code = ?3`).bind(d7, d30, code).first();
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
    db.prepare('SELECT * FROM events WHERE code = ? ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?').bind(code, perPage, (page - 1) * perPage),
    db.prepare('SELECT COUNT(*) AS n FROM events WHERE code = ?').bind(code),
  ]);
  return { rows: rows.results || [], total: cnt.results[0]?.n || 0 };
}

export async function allEvents(db, code) {
  const r = await db.prepare('SELECT * FROM events WHERE code = ? ORDER BY ts DESC, id DESC').bind(code).all();
  return r.results || [];
}
