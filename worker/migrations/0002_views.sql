-- 0002: bio sayfası görüntülemesi ('view' olayı).
-- SQLite CHECK kısıtını ALTER ile değiştiremez: tablo yeniden kurulur, satırlar (id'leriyle) kopyalanır.
-- D1 bir migration dosyasını tek parti olarak çalıştırır; BEGIN/COMMIT yazılmaz (D1 reddeder).
-- events'e yabancı anahtar bağlı değil; DROP güvenli.

CREATE TABLE events_new (
  id       INTEGER PRIMARY KEY,
  ts       INTEGER NOT NULL,             -- unix ms
  day      TEXT NOT NULL,                -- YYYY-MM-DD, Europe/Istanbul
  type     TEXT NOT NULL CHECK (type IN ('visit','click','purchase','view')),
  code     TEXT,                         -- influencer kodu; ref'siz olaylarda NULL
  target   TEXT,                         -- click: mağaza adı; visit: yönlendirilen hedef; view: kaynak (instagram, direkt, web:alan…)
  href     TEXT,
  device   TEXT,                         -- mobile / tablet / desktop
  browser  TEXT,                         -- Instagram in-app, TikTok in-app, Safari, Chrome...
  ua       TEXT,
  country  TEXT,
  city     TEXT,
  referer  TEXT,                         -- yalnız alan adı
  ip_hash  TEXT,                         -- SHA-256(ip + SESSION_SECRET) kısaltılmış; ham IP tutulmaz (KVKK)
  amount   REAL,
  currency TEXT,
  order_id TEXT,
  source   TEXT,
  note     TEXT
);

INSERT INTO events_new (id, ts, day, type, code, target, href, device, browser, ua, country, city, referer, ip_hash, amount, currency, order_id, source, note)
  SELECT id, ts, day, type, code, target, href, device, browser, ua, country, city, referer, ip_hash, amount, currency, order_id, source, note
  FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_code_day        ON events (code, day);
CREATE INDEX IF NOT EXISTS idx_events_code_ts         ON events (code, ts);
CREATE INDEX IF NOT EXISTS idx_events_type_day        ON events (type, day);
CREATE INDEX IF NOT EXISTS idx_events_order           ON events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_type_target_day ON events (type, target, day);
CREATE INDEX IF NOT EXISTS idx_events_ip_ts           ON events (ip_hash, ts);   -- 30 sn tekilleştirme + tıklamanın kaynağını bulma
