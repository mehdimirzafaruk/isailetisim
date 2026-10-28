#!/usr/bin/env bash
# Yerel uçtan uca test. Önce: npx wrangler d1 migrations apply isailetisim --local && npx wrangler dev --local --port 8788
# Kullanım: bash test/e2e.sh   (şifre/anahtar .dev.vars'tan okunur; başka port: BASE=http://localhost:8789 bash test/e2e.sh)
set -u
B=${BASE:-http://localhost:8788}
cd "$(dirname "$0")/.."
PW=$(grep '^ADMIN_PASSWORD=' .dev.vars | cut -d= -f2-)
KEY=$(grep '^PURCHASE_KEY=' .dev.vars | cut -d= -f2-)
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0'
J=$(mktemp); CK=$(mktemp)
pass=0; fail=0
ok(){ echo "OK   $1"; pass=$((pass+1)); }
no(){ echo "FAIL $1 :: $2"; fail=$((fail+1)); }
check(){ [ "$2" = "$3" ] && ok "$1" || no "$1" "beklenen=$3 gelen=$2"; }
q(){ npx wrangler d1 execute isailetisim --local --json --command "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0].results;console.log(Object.values(r[0]||{})[0])})'; }

# 0) Statik site ve 404
check "GET / statik" "$(curl -s -o /dev/null -w '%{http_code}' $B/)" 200
check "GET /assets/favicon.svg" "$(curl -s -o /dev/null -w '%{http_code}' $B/assets/favicon.svg)" 200
check "GET /yok-boyle-bir-sey -> 404" "$(curl -s -o /dev/null -w '%{http_code}' $B/yok-boyle-bir-sey)" 404
check "worker/ yayınlanmıyor" "$(curl -s -o /dev/null -w '%{http_code}' $B/worker/wrangler.toml)" 404
check "README yayınlanmıyor" "$(curl -s -o /dev/null -w '%{http_code}' $B/worker/README.md)" 404

# 1) Giriş: 10 yanlış -> 401, 11. -> 429
q "DELETE FROM login_attempts" >/dev/null
for i in $(seq 1 10); do c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -d 'password=yanlis' $B/admin/login); [ "$c" = 401 ] || no "yanlış şifre $i" "$c"; done; ok "10 yanlış şifre -> 401"
check "11. deneme -> 429" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d 'password=yanlis' $B/admin/login)" 429
check "doğru şifre de kilitli -> 429" "$(curl -s -o /dev/null -w '%{http_code}' -X POST --data-urlencode "password=$PW" $B/admin/login)" 429
q "DELETE FROM login_attempts" >/dev/null
check "admin girişsiz -> giriş sayfası" "$(curl -s $B/admin | grep -c 'name="password"')" 1
check "çapraz Origin POST -> 403" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' -X POST --data-urlencode "password=$PW" $B/admin/login)" 403
check "doğru şifre -> 303" "$(curl -s -c $CK -o /dev/null -w '%{http_code}' -X POST --data-urlencode "password=$PW" $B/admin/login)" 303
grep -q ysess $CK && ok "oturum çerezi" || no "oturum çerezi" "yok"

# 2) Link oluştur (panel formu)
q "DELETE FROM events; DELETE FROM influencers; DELETE FROM unknown_hits" >/dev/null
check "yeni link test -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" --data-urlencode 'name=Test Kişi' -d 'platform=Instagram&code=test&note=Kasım+C11+Pro&target=%2F%23urun-c11-pro' $B/admin/new)" 303
check "kanal kodu ig -> 400" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -d 'name=X&platform=TikTok&code=ig&target=%2F' $B/admin/new)" 400
check "kanal kodu hata mesajı" "$(curl -s -b $CK -X POST -d 'name=X&platform=TikTok&code=tt&target=%2F' $B/admin/new | grep -c 'kanal linki için ayrılmış')" 1
check "ayrılmış kod assets -> 400" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -d 'name=X&platform=TikTok&code=assets&target=%2F' $B/admin/new)" 400
check "aynı kod -> 409" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -d 'name=X&platform=TikTok&code=test&target=%2F' $B/admin/new)" 409
check "geçersiz hedef -> 400" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -d 'name=X&platform=TikTok&code=xx&target=javascript%3Aalert(1)' $B/admin/new)" 400
curl -s -b $CK -o /dev/null -X POST --data-urlencode 'name=<script>alert(1)</script> Ayşe' -d 'platform=TikTok&code=ayse&target=https%3A%2F%2Fwww.trendyol.com%2Fyasomi%2Fc11-p-1' $B/admin/new
check "influencer sayısı" "$(q 'SELECT COUNT(*) FROM influencers')" 2

# 3) /i/test -> 302 + çerez + visit
H=$(curl -s -D - -o /dev/null -A "$UA" -H 'Referer: https://l.instagram.com/?u=x' -H 'cf-ipcountry: TR' $B/i/test)
check "/i/test 302" "$(echo "$H" | head -1 | awk '{print $2}')" 302
check "Location" "$(echo "$H" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)" "/?ref=test#urun-c11-pro"
echo "$H" | grep -i '^set-cookie:' | grep -q 'yref=test; Max-Age=2592000; Path=/; SameSite=Lax; Secure' && ok "Set-Cookie yref" || no "Set-Cookie" "$(echo "$H" | grep -i set-cookie)"
sleep 1
check "visit satırı" "$(q "SELECT COUNT(*) FROM events WHERE type='visit' AND code='test'")" 1
check "visit tarayıcı" "$(q "SELECT browser FROM events WHERE type='visit' AND code='test'")" "Instagram in-app"
check "visit referer alan adı" "$(q "SELECT referer FROM events WHERE type='visit' AND code='test'")" "l.instagram.com"
curl -s -o /dev/null -A "$UA" $B/i/test; sleep 1
check "30 sn içinde 2. ziyaret tekilleşti" "$(q "SELECT COUNT(*) FROM events WHERE type='visit' AND code='test'")" 1
curl -s -o /dev/null -A "$UA" -H 'cf-connecting-ip: 203.0.113.9' $B/i/test; sleep 1
check "farklı IP ayrı sayılır" "$(q "SELECT COUNT(*) FROM events WHERE type='visit' AND code='test'")" 2
curl -s -o /dev/null -A 'facebookexternalhit/1.1' -H 'cf-connecting-ip: 203.0.113.10' $B/i/test; sleep 1
check "bot önizlemesi sayılmaz" "$(q "SELECT COUNT(*) FROM events WHERE type='visit' AND code='test'")" 2
check "ham IP saklanmıyor" "$(q "SELECT COUNT(*) FROM events WHERE ip_hash LIKE '%203.0%' OR ua LIKE '%203.0.113%'")" 0
check "kısa yol /test -> 302" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -H 'cf-connecting-ip: 203.0.113.11' $B/test)" 302
check "dış hedef /i/ayse -> trendyol" "$(curl -s -D - -o /dev/null -A "$UA" $B/i/ayse | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)" "https://www.trendyol.com/yasomi/c11-p-1"
check "bilinmeyen kod -> /" "$(curl -s -D - -o /dev/null $B/i/kimsebu | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)" "/"
sleep 1
check "unknown_hits" "$(q "SELECT COUNT(*) FROM unknown_hits WHERE code='kimsebu'")" 1
check "bilinmeyen kod olay yazmaz" "$(q "SELECT COUNT(*) FROM events WHERE code='kimsebu'")" 0

# 4) /api/click
check "click (gövde ref) -> 204" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -X POST -H 'Content-Type: application/json' -d '{"target":"trendyol","ref":"test","href":"https://www.trendyol.com/magaza/yasomi-m-109844","page_ts":1}' $B/api/click)" 204
check "aynı click 5 sn içinde tekil" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -X POST -d '{"target":"trendyol","ref":"test","href":"https://www.trendyol.com/x"}' $B/api/click)" 204
curl -s -o /dev/null -A "$UA" -X POST -d '{"target":"site-c11-pro","ref":"test","href":"https://www.yasomi.com.tr/c11?utm_content=test"}' $B/api/click
curl -s -o /dev/null -A "$UA" -X POST -H 'Cookie: yref=ayse' -d '{"target":"amazon","ref":"test","href":"https://www.amazon.com.tr/x"}' $B/api/click
curl -s -o /dev/null -A "$UA" -X POST -d '{"target":"hepsiburada","href":"https://www.hepsiburada.com/x"}' $B/api/click
check "click satırları (test)" "$(q "SELECT COUNT(*) FROM events WHERE type='click' AND code='test'")" 2
check "çerez gövdeden önce gelir" "$(q "SELECT code FROM events WHERE type='click' AND target='amazon'")" ayse
check "ref'siz click NULL kod" "$(q "SELECT COUNT(*) FROM events WHERE type='click' AND code IS NULL")" 1
check "click href saklandı" "$(q "SELECT href FROM events WHERE type='click' AND target='trendyol'")" "https://www.trendyol.com/magaza/yasomi-m-109844"
check "bozuk JSON -> 400" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -X POST -d 'nope' $B/api/click)" 400
check "GET /api/click -> 405" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/click)" 405

# 5) /api/purchase
check "purchase anahtarsız -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{"ref":"test","amount":100}' $B/api/purchase)" 401
check "purchase yanlış anahtar -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'X-Postback-Key: yanlis' -d '{"ref":"test","amount":100}' $B/api/purchase)" 401
curl -s -o $J -w '%{http_code}' -X POST -H "X-Postback-Key: $KEY" -H 'Content-Type: application/json' -d '{"ref":"test","order_id":"T-1001","amount":5999.9,"currency":"TRY","source":"site","note":"ticimax"}' $B/api/purchase > $J.code
check "purchase anahtarlı -> 200" "$(cat $J.code)" 200
grep -q '"attributed":true' $J && ok "purchase atandı" || no "purchase atandı" "$(cat $J)"
check "aynı sipariş tekrar -> duplicate" "$(curl -s -X POST -H "X-Postback-Key: $KEY" -d '{"ref":"test","order_id":"T-1001","amount":5999.9}' $B/api/purchase | grep -c '"duplicate":true')" 1
check "ref'siz satış atanmaz" "$(curl -s -X POST -H "X-Postback-Key: $KEY" -d '{"ref":"yok","order_id":"T-1002","amount":10}' $B/api/purchase | grep -c '"attributed":false')" 1
check "geçersiz tutar -> 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Postback-Key: $KEY" -d '{"ref":"test","amount":"abc"}' $B/api/purchase)" 400
check "CORS preflight yasomi.com.tr" "$(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://www.yasomi.com.tr' -H 'Access-Control-Request-Method: POST' $B/api/purchase | grep -ci '^access-control-allow-origin: https://www.yasomi.com.tr')" 1

# 6) Panel: elle satın alma
check "elle satış -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -d 'date=2026-10-27&source=trendyol&amount=5.999&order_id=TY-55' $B/admin/i/test/purchase)" 303
check "elle satış tutarı" "$(q "SELECT amount FROM events WHERE order_id='TY-55'")" 5999
check "elle satış günü" "$(q "SELECT day FROM events WHERE order_id='TY-55'")" 2026-10-27

# 7) Panel sayfaları sayıları gösteriyor mu
curl -s -b $CK $B/admin > $J
check "/admin 200" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin)" 200
grep -q '11.998,9 ₺' $J && ok "/admin ciro 11.998,9 ₺" || no "/admin ciro" "$(grep -o '[0-9.,]* ₺' $J | head -5 | tr '\n' ' ')"
grep -q '&lt;script&gt;alert(1)&lt;/script&gt; Ayşe' $J && ok "/admin isim kaçışlandı" || no "kaçış" "?"
grep -q '<script>alert(1)' $J && no "XSS" "ham script var" || ok "ham <script>alert yok"
curl -s -b $CK $B/admin/i/test > $J
check "/admin/i/test 200" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/i/test)" 200
grep -q "$B/i/test\|https://isailetisim.com/i/test" $J && ok "detay: link" || no "detay link" "?"
grep -q '>trendyol<' $J && ok "detay: hedef tablosu trendyol" || no "hedef tablosu" "?"
grep -q 'Instagram in-app' $J && ok "detay: tarayıcı kırılımı" || no "tarayıcı" "?"
grep -q '#TY-55' $J && ok "detay: olay kaydında sipariş" || no "olay kaydı" "?"
grep -q '<svg class="d" viewBox' $J && grep -q '<svg class="m" viewBox' $J && ok "detay: SVG grafik (90g + mobil 30g)" || no "grafik" "?"
grep -q 'Sayfa görüntüleme (landing)' $J && ok "detay: landing satırı" || no "landing satırı" "?"
check "detay: günlük tablo 90 satır" "$(grep -o '<tr class="zero"><td>\|<tr class=""><td>' $J | wc -l | tr -d ' ')" 90
curl -s -b $CK -D $J.h $B/admin/i/test/export.csv > $J
grep -qi 'content-disposition: attachment' $J.h && ok "CSV indirme başlığı" || no "CSV başlık" "?"
check "CSV satır sayısı (başlık + 7 olay)" "$(wc -l < $J | tr -d ' ')" 8
check "/admin/settings 200" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/settings)" 200
check "/admin/new 200" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/new)" 200
check "/admin/i/yok 404" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/i/yok)" 404
check "düzenle -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST --data-urlencode 'name=Test Kişi' -d 'platform=YouTube&note=yeni&target=%2F' $B/admin/i/test/edit)" 303
check "pasifleştir -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST $B/admin/i/test/toggle)" 303
check "pasif link -> / (sayılmaz)" "$(curl -s -D - -o /dev/null -A "$UA" -H 'cf-connecting-ip: 198.51.100.1' $B/i/test | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)" "/"
curl -s -b $CK -o /dev/null -X POST $B/admin/i/test/toggle

# 8) Bio sayfası görüntülemesi (view)
q "DELETE FROM events WHERE type='view'" >/dev/null
FB='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]'
SAF='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
vq(){ q "SELECT $1 FROM events WHERE type='view' AND ip_hash=(SELECT ip_hash FROM events WHERE type='view' ORDER BY id DESC LIMIT 1) ORDER BY id DESC LIMIT 1"; }
check "GET / Instagram UA -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -H 'cf-connecting-ip: 192.0.2.1' -H 'cf-ipcountry: TR' $B/)" 200
sleep 1
check "view: instagram (uygulama içi)" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" instagram
check "view: tarayıcı" "$(q "SELECT browser FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" "Instagram in-app"
curl -s -o /dev/null -A "$UA" -H 'cf-connecting-ip: 192.0.2.1' $B/; sleep 1
check "aynı IP 30 sn içinde 2. görüntüleme sayılmaz" "$(q "SELECT COUNT(*) FROM events WHERE type='view'")" 1
curl -s -o /dev/null -A "$UA" -H 'cf-connecting-ip: 192.0.2.1' "$B/?s=tt"; sleep 1
check "farklı kaynakla da olsa 30 sn tekil" "$(q "SELECT COUNT(*) FROM events WHERE type='view'")" 1
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.2' "$B/?s=tt"; sleep 1
check "?s=tt -> tiktok" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" tiktok
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.3' -H 'Referer: https://l.facebook.com/' $B/; sleep 1
check "Referer l.facebook.com -> facebook" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" facebook
check "view referer alan adı" "$(q "SELECT referer FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" l.facebook.com
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.4' -H 'Referer: https://www.google.com.tr/' $B/; sleep 1
check "Referer google -> google" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" google
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.5' -H 'Referer: https://www.trendyol.com/x' $B/; sleep 1
check "Referer başka site -> web:" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" web:trendyol.com
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.6' "$B/?ref=test"; sleep 1
check "?ref=test -> influencer" "$(q "SELECT target || '/' || code FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" influencer/test
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.7' "$B/?ref=kimsebu"; sleep 1
check "bilinmeyen ?ref -> direkt, kod yok" "$(q "SELECT target || '/' || COALESCE(code,'-') FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" direkt/-
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.8' "$B/?s=Kasım%20Çekiliş"; sleep 1
check "özel ?s= -> s:slug" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" s:kasim-cekilis
curl -s -o /dev/null -A "$FB" -H 'cf-connecting-ip: 192.0.2.9' $B/; sleep 1
check "Facebook uygulama içi -> facebook" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" facebook
N0=$(q "SELECT COUNT(*) FROM events WHERE type='view'")
curl -s -o /dev/null -H 'cf-connecting-ip: 192.0.2.20' $B/
curl -s -o /dev/null -A 'facebookexternalhit/1.1' -H 'cf-connecting-ip: 192.0.2.21' $B/
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.22' $B/assets/logo-trendyol.svg
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.23' $B/yok-boyle-bir-sey
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.24' -H 'Sec-Purpose: prefetch' $B/
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.25' -H 'Cookie: ynoview=1' $B/
curl -s -o /dev/null -I -A "$SAF" -H 'cf-connecting-ip: 192.0.2.26' $B/
sleep 1
check "curl UA / bot / asset / 404 / prefetch / ynoview / HEAD sayılmaz" "$(q "SELECT COUNT(*) FROM events WHERE type='view'")" "$N0"
C0=$(q "SELECT COUNT(*) FROM events WHERE type='click'")
check "ynoview çerezli tıklama -> 204" "$(curl -s -o /dev/null -w '%{http_code}' -A "$SAF" -H 'Cookie: ynoview=1' -H 'cf-connecting-ip: 192.0.2.25' -X POST -d '{"target":"amazon","href":"https://www.amazon.com.tr/x"}' $B/api/click)" 204
check "ynoview tıklaması yazılmadı" "$(q "SELECT COUNT(*) FROM events WHERE type='click'")" "$C0"
for c in ig tt fb x yt ln wa tg; do
  L=$(curl -s -D - -o /dev/null -A "$SAF" $B/$c | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)
  [ "$L" = "/?s=$c" ] || no "/$c -> /?s=$c" "$L"
done; ok "kanal linkleri /ig…/tg -> 302 /?s=…"
check "/ig 302" "$(curl -s -o /dev/null -w '%{http_code}' $B/ig)" 302
check "/IG/ büyük harf + eğik çizgi" "$(curl -s -D - -o /dev/null $B/IG/ | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)" "/?s=ig"
curl -s -o /dev/null -L -A "$SAF" -H 'cf-connecting-ip: 192.0.2.30' $B/yt; sleep 1
check "/yt takip edilince youtube görüntülemesi" "$(q "SELECT target FROM events WHERE type='view' ORDER BY id DESC LIMIT 1")" youtube
# tıklama kaynağa bağlanır (aynı IP'nin son ziyareti)
curl -s -o /dev/null -A "$SAF" -H 'cf-connecting-ip: 192.0.2.30' -X POST -d '{"target":"trendyol","href":"https://www.trendyol.com/x"}' $B/api/click

# 9) Panel sayıları SQL ile aynı mı
curl -s -b $CK -c $CK -o /dev/null -X POST --data-urlencode "password=$PW" $B/admin/login
V=$(q "SELECT COUNT(*) FROM events WHERE type='view'")
U=$(q "SELECT COUNT(DISTINCT ip_hash) FROM events WHERE type='view'")
C=$(q "SELECT COUNT(*) FROM events WHERE type='click'")
curl -s -b $CK "$B/admin/ziyaretciler?range=tumu" > $J
check "/admin/ziyaretciler 200" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/ziyaretciler)" 200
grep -q "<div class=\"l\">Ziyaret</div><div class=\"v\" title=\"Tümü\">$V</div>" $J && ok "ziyaretçiler: ziyaret = $V" || no "ziyaretçiler ziyaret" "$(grep -o 'title="Tümü">[0-9.]*' $J | head -4 | tr '\n' ' ')"
grep -q "<div class=\"l\">Tekil ziyaretçi</div><div class=\"v\" title=\"Tümü\">$U</div>" $J && ok "ziyaretçiler: tekil = $U" || no "tekil" "$(grep -o 'title="Tümü">[0-9.]*' $J | tr '\n' ' ')"
grep -q "<div class=\"l\">Tıklama</div><div class=\"v\" title=\"Tümü\">$C</div>" $J && ok "ziyaretçiler: tıklama = $C" || no "tıklama" "$(grep -o 'title="Tümü">[0-9.]*' $J | tr '\n' ' ')"
tr -d '\n' < $J | sed 's/>[[:space:]]*</></g' | grep -q '<td class="src">YouTube</td><td class="n">1</td><td class="n hm">1</td><td class="n">[0-9,]*%</td><td class="n">1</td><td class="n">100%</td>' && ok "kaynak tablosu: YouTube 1 ziyaret 1 tıklama (CTR 100%)" || no "YouTube satırı" "$(grep -o '<td class="src">YouTube</td>.\{0,160\}' $J)"
grep -q '<td class="src">Etiket: kasim-cekilis</td>' $J && ok "kaynak tablosu: özel etiket" || no "özel etiket" "?"
check "saat grafiği 24 sütun" "$(grep -o '<div class="b">' $J | wc -l | tr -d ' ')" 24
curl -s -b $CK $B/admin > $J
grep -q 'Nereden geliyorlar?' $J && ok "/admin: kaynak tablosu" || no "/admin kaynak" "?"
grep -q "<div class=\"l\">Ziyaret</div><div class=\"v\" title=\"30 gün\">$V</div>" $J && ok "/admin: bio ziyaret = $V" || no "/admin bio ziyaret" "$(grep -o 'title="30 gün">[0-9.]*' $J | tr '\n' ' ')"
curl -s -b $CK -D $J.h "$B/admin/ziyaretciler/export.csv?range=30" > $J
grep -qi 'content-disposition: attachment; filename="isailetisim-ziyaretciler-30-' $J.h && ok "ziyaret CSV başlığı" || no "ziyaret CSV" "$(grep -i content-disp $J.h)"
check "ziyaret CSV satır sayısı (başlık + $V)" "$(wc -l < $J | tr -d ' ')" "$((V + 1))"
# influencer sayfaları görüntülemeyi olay kaydına karıştırmaz, landing satırında sayar
curl -s -b $CK $B/admin/i/test > $J
grep -q 'Sayfa görüntüleme (landing): <b>1</b>' $J && ok "influencer landing = 1" || no "landing" "$(grep -o 'landing): <b>[0-9]*' $J)"
curl -s -b $CK $B/admin/i/test/export.csv > $J
check "influencer CSV'de view yok" "$(grep -c ';view;' $J)" 0
# Beni sayma / Tekrar say
check "ayarlar: kanal linkleri" "$(curl -s -b $CK $B/admin/settings | grep -o 'data-copy="[^"]*/\(ig\|tt\|fb\|x\|yt\|ln\|wa\|tg\)"' | wc -l | tr -d ' ')" 8
H=$(curl -s -b $CK -c $CK -D - -o /dev/null -X POST -H "Origin: $B" -d 'mode=on' $B/admin/settings/noview)
echo "$H" | grep -i '^set-cookie:' | grep -q 'ynoview=1; Max-Age=31536000; Path=/' && ok "Beni sayma çerezi" || no "Beni sayma" "$(echo "$H" | grep -i set-cookie)"
check "ayarlar: 'sayılmıyor' durumu" "$(curl -s -b $CK $B/admin/settings | grep -c 'Bu tarayıcı sayılmıyor')" 1
N0=$(q "SELECT COUNT(*) FROM events WHERE type='view'")
curl -s -o /dev/null -b $CK -A "$SAF" -H 'cf-connecting-ip: 192.0.2.40' $B/; sleep 1
check "Beni sayma sonrası görüntüleme yazılmaz" "$(q "SELECT COUNT(*) FROM events WHERE type='view'")" "$N0"
H=$(curl -s -b $CK -c $CK -D - -o /dev/null -X POST -d 'mode=off' $B/admin/settings/noview)
echo "$H" | grep -i '^set-cookie:' | grep -q 'ynoview=; Max-Age=0; Path=/' && ok "Tekrar say çerezi siler" || no "Tekrar say" "$(echo "$H" | grep -i set-cookie)"
curl -s -o /dev/null -b $CK -A "$SAF" -H 'cf-connecting-ip: 192.0.2.40' $B/; sleep 1
check "Tekrar say sonrası görüntüleme yazılır" "$(q "SELECT COUNT(*) FROM events WHERE type='view'")" "$((N0 + 1))"
check "çıkış -> 303" "$(curl -s -b $CK -c $CK -o /dev/null -w '%{http_code}' -X POST $B/admin/logout)" 303
check "çıkıştan sonra giriş sayfası" "$(curl -s -b $CK $B/admin | grep -c 'name="password"')" 1

rm -f $J $J.code $J.h $CK
echo "---- $pass geçti, $fail kaldı"
[ $fail = 0 ]
