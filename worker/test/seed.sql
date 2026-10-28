-- YALNIZ YEREL: panel ekran görüntüsü / elle deneme için örnek veri. Mevcut olayları ve influencer'ları SİLER.
-- npx wrangler d1 execute isailetisim --local --file test/seed.sql
-- Son 20 güne yayılmış: 220 görüntüleme (çeşitli kaynaklar), 60 tıklama (görüntülemeden 90 sn sonra, aynı ip_hash), 20 influencer ziyareti, 5 satış.
DELETE FROM events;
DELETE FROM influencers;
INSERT INTO influencers (code, name, platform, note, target, active, created_at) VALUES
  ('ayse-kaya', 'Ayşe Kaya', 'Instagram', 'Kasım C11 Pro kampanyası', '/', 1, (CAST(strftime('%s','now') AS INTEGER) - 25 * 86400) * 1000),
  ('mehmet-yilmaz', 'Mehmet Yılmaz', 'TikTok', 'Barter', '/#h-products', 1, (CAST(strftime('%s','now') AS INTEGER) - 22 * 86400) * 1000);

-- görüntülemeler
INSERT INTO events (ts, day, type, code, target, href, device, browser, ua, country, city, referer, ip_hash)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 220),
b AS (SELECT CAST(strftime('%s','now') AS INTEGER) AS now),
v AS (
  SELECT n, (b.now - ((n * 7919) % 1728000)) * 1000 AS ts,
    CASE WHEN n % 37 = 0 THEN 's:kasim-cekilis' ELSE CASE n % 16
      WHEN 0 THEN 'instagram' WHEN 1 THEN 'instagram' WHEN 2 THEN 'instagram' WHEN 3 THEN 'instagram' WHEN 4 THEN 'instagram'
      WHEN 5 THEN 'tiktok' WHEN 6 THEN 'tiktok' WHEN 7 THEN 'direkt' WHEN 8 THEN 'direkt' WHEN 9 THEN 'facebook'
      WHEN 10 THEN 'google' WHEN 11 THEN 'influencer' WHEN 12 THEN 'web:trendyol.com' WHEN 13 THEN 'youtube'
      WHEN 14 THEN 'whatsapp' ELSE 'web:pinterest.com' END END AS src
  FROM seq, b)
SELECT ts, date(ts / 1000 + 10800, 'unixepoch'), 'view',
  CASE WHEN src = 'influencer' THEN CASE WHEN n % 2 = 0 THEN 'ayse-kaya' ELSE 'mehmet-yilmaz' END END,
  src,
  CASE WHEN src = 'influencer' THEN '/?ref=' || CASE WHEN n % 2 = 0 THEN 'ayse-kaya' ELSE 'mehmet-yilmaz' END
       WHEN src = 's:kasim-cekilis' THEN '/?s=kasim-cekilis' WHEN src IN ('instagram', 'tiktok') AND n % 3 = 0 THEN '/?s=' || substr(src, 1, 1) || CASE src WHEN 'instagram' THEN 'g' ELSE 't' END ELSE '/' END,
  CASE WHEN n % 6 = 0 THEN 'desktop' WHEN n % 23 = 0 THEN 'tablet' ELSE 'mobile' END,
  CASE src WHEN 'instagram' THEN 'Instagram in-app' WHEN 'tiktok' THEN 'TikTok in-app' WHEN 'facebook' THEN 'Facebook in-app'
    ELSE CASE n % 3 WHEN 0 THEN 'Safari' WHEN 1 THEN 'Chrome' ELSE 'Samsung Internet' END END,
  'seed',
  CASE WHEN n % 19 = 0 THEN 'DE' WHEN n % 29 = 0 THEN 'NL' ELSE 'TR' END,
  CASE WHEN n % 19 = 0 THEN 'Berlin' WHEN n % 29 = 0 THEN 'Amsterdam' ELSE CASE n % 7
    WHEN 0 THEN 'İstanbul' WHEN 1 THEN 'İstanbul' WHEN 2 THEN 'Ankara' WHEN 3 THEN 'İzmir' WHEN 4 THEN 'Bursa' WHEN 5 THEN 'Antalya' ELSE 'Konya' END END,
  CASE src WHEN 'google' THEN 'google.com.tr' WHEN 'facebook' THEN 'l.facebook.com' WHEN 'web:trendyol.com' THEN 'trendyol.com'
    WHEN 'web:pinterest.com' THEN 'pinterest.com' WHEN 'youtube' THEN 'youtube.com' ELSE CASE WHEN src = 'instagram' AND n % 2 = 0 THEN 'l.instagram.com' END END,
  printf('seed%012d', n % 170)
FROM v;

-- tıklamalar: her biri bir görüntülemeden (m = 3k) 90 sn sonra, aynı ip_hash
INSERT INTO events (ts, day, type, code, target, href, device, browser, ua, country, city, ip_hash)
WITH RECURSIVE seq(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM seq WHERE k < 60),
b AS (SELECT CAST(strftime('%s','now') AS INTEGER) AS now)
SELECT (b.now - ((k * 3 * 7919) % 1728000) + 90) * 1000, date(b.now - ((k * 3 * 7919) % 1728000) + 90 + 10800, 'unixepoch'), 'click',
  NULL,
  CASE k % 5 WHEN 0 THEN 'trendyol' WHEN 1 THEN 'trendyol' WHEN 2 THEN 'hepsiburada' WHEN 3 THEN 'site-c11-pro' ELSE 'amazon' END,
  'https://www.trendyol.com/magaza/yasomi-m-109844', 'mobile', 'Safari', 'seed', 'TR', 'İstanbul',
  printf('seed%012d', (k * 3) % 170)
FROM seq, b;

-- influencer ziyaretleri (/i/:kod)
INSERT INTO events (ts, day, type, code, target, href, device, browser, ua, country, city, ip_hash)
WITH RECURSIVE seq(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM seq WHERE k < 20),
b AS (SELECT CAST(strftime('%s','now') AS INTEGER) AS now)
SELECT (b.now - ((k * 104729) % 1728000)) * 1000, date(b.now - ((k * 104729) % 1728000) + 10800, 'unixepoch'), 'visit',
  CASE WHEN k % 2 = 0 THEN 'ayse-kaya' ELSE 'mehmet-yilmaz' END, '/', '/?ref=x', 'mobile', 'Instagram in-app', 'seed', 'TR', 'Ankara',
  printf('seedv%011d', k)
FROM seq, b;

INSERT INTO events (ts, day, type, code, target, amount, currency, order_id, source, note)
SELECT (CAST(strftime('%s','now') AS INTEGER) - d * 86400) * 1000, date(CAST(strftime('%s','now') AS INTEGER) - d * 86400 + 10800, 'unixepoch'),
  'purchase', c, 'site', 5999, 'TRY', 'SEED-' || d, 'site', 'seed'
FROM (SELECT 1 AS d, 'ayse-kaya' AS c UNION ALL SELECT 3, 'ayse-kaya' UNION ALL SELECT 6, 'mehmet-yilmaz' UNION ALL SELECT 9, NULL UNION ALL SELECT 14, 'ayse-kaya');
