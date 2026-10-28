-- 0003: şifre kasası (/admin/kasa).
-- Şifre ve not AES-256-GCM ile şifreli saklanır (anahtar: Worker secret VAULT_KEY; src/vault.js).
-- D1 bir migration dosyasını tek parti olarak çalıştırır; BEGIN/COMMIT yazılmaz (D1 reddeder).

CREATE TABLE vault_entries (
  id           INTEGER PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,     -- 16 hex rastgele; URL'de kullanılır ve AES-GCM AAD'si (ciphertext satıra bağlı)
  title        TEXT NOT NULL,            -- platform / site adı
  url          TEXT,
  username     TEXT,
  email        TEXT,
  phone        TEXT,
  category     TEXT NOT NULL DEFAULT 'diger', -- pazaryeri | sosyal | reklam | mail | banka | sunucu | diger
  password_enc TEXT,                     -- base64url( iv(12 bayt) || AES-256-GCM ciphertext+tag ); boşsa NULL
  note_enc     TEXT,                     -- aynı şema; not da şifreli
  created_at   INTEGER NOT NULL,         -- unix ms
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_vault_title ON vault_entries (title);

CREATE TABLE vault_audit (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  action    TEXT NOT NULL,               -- unlock | create | update | delete | reveal | export
  entry_uid TEXT,
  title     TEXT,
  ip_hash   TEXT
);
CREATE INDEX idx_vault_audit_ts ON vault_audit (ts);
