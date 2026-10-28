-- isailetisim influencer takibi: güncel şema (migrations/0001 + 0002 + 0003'ün sonucu; yeni kurulumda migrations kullan)
CREATE TABLE IF NOT EXISTS influencers (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  platform   TEXT,
  note       TEXT,
  target     TEXT NOT NULL DEFAULT '/',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL            -- unix ms
);

CREATE TABLE IF NOT EXISTS events (
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
CREATE INDEX IF NOT EXISTS idx_events_code_day ON events (code, day);
CREATE INDEX IF NOT EXISTS idx_events_code_ts  ON events (code, ts);
CREATE INDEX IF NOT EXISTS idx_events_type_day ON events (type, day);
CREATE INDEX IF NOT EXISTS idx_events_order    ON events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_type_target_day ON events (type, target, day);
CREATE INDEX IF NOT EXISTS idx_events_ip_ts    ON events (ip_hash, ts);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (ip_hash, ts);

CREATE TABLE IF NOT EXISTS unknown_hits (
  code TEXT NOT NULL,
  ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unknown_hits_ts ON unknown_hits (ts);

-- Şifre kasası (0003). Şifre ve not AES-256-GCM ile şifreli (src/vault.js).
CREATE TABLE IF NOT EXISTS vault_entries (
  id           INTEGER PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,     -- 16 hex rastgele; URL'de kullanılır ve AES-GCM AAD'si
  title        TEXT NOT NULL,
  url          TEXT,
  username     TEXT,
  email        TEXT,
  phone        TEXT,
  category     TEXT NOT NULL DEFAULT 'diger', -- pazaryeri | sosyal | reklam | mail | banka | sunucu | diger
  password_enc TEXT,                     -- base64url( iv(12 bayt) || ciphertext+tag ); boşsa NULL
  note_enc     TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_title ON vault_entries (title);

CREATE TABLE IF NOT EXISTS vault_audit (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  action    TEXT NOT NULL,               -- unlock | create | update | delete | reveal | export
  entry_uid TEXT,
  title     TEXT,
  ip_hash   TEXT
);
CREATE INDEX IF NOT EXISTS idx_vault_audit_ts ON vault_audit (ts);
