#!/usr/bin/env bash
# Yerel uçtan uca test. Önce: npx wrangler d1 migrations apply isailetisim --local && npx wrangler dev --local --port 8788 --infer-origin-from-routes=false
# (--infer-origin-from-routes=false: Host başlığı Worker'a olduğu gibi ulaşsın; alan adı testleri buna dayanır)
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
grep -q 'data-copy="https://yasomi.net/i/test"\|<code>yasomi.net/i/test</code>\|https://yasomi.net/i/test' $J && ok "detay: link yasomi.net/i/test" || no "detay link" "$(grep -o '[a-z.:/]*/i/test' $J | sort -u | tr '\n' ' ')"
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
# 10) Alan adı: yasomi.net kanonik, isailetisim.com /api dışında 301
loc(){ curl -s -D - -o /dev/null "$@" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
check "eski alan adı /foo?x=1 -> 301" "$(code -H 'Host: isailetisim.com' "$B/foo?x=1")" 301
check "eski alan adı Location" "$(loc -H 'Host: isailetisim.com' "$B/foo?x=1")" "https://yasomi.net/foo?x=1"
check "eski www /i/test -> yasomi.net/i/test" "$(loc -H 'Host: www.isailetisim.com' "$B/i/test")" "https://yasomi.net/i/test"
check "eski alan adı / -> yasomi.net/" "$(loc -H 'Host: isailetisim.com' "$B/")" "https://yasomi.net/"
check "eski alan adı /admin -> yasomi.net/admin" "$(loc -H 'Host: isailetisim.com' "$B/admin")" "https://yasomi.net/admin"
check "eski alan adı /api/click yönlenmez (204)" "$(code -H 'Host: isailetisim.com' -X POST -d '{"target":"x"}' $B/api/click)" 204
check "eski www /api/click yönlenmez (204)" "$(code -H 'Host: www.isailetisim.com' -X POST -d '{"target":"x"}' $B/api/click)" 204
check "eski alan adı /api/purchase işlenir (anahtarsız 401)" "$(code -H 'Host: isailetisim.com' -X POST -d '{"amount":1}' $B/api/purchase)" 401
check "eski alan adı CORS preflight" "$(curl -s -D - -o /dev/null -X OPTIONS -H 'Host: isailetisim.com' -H 'Origin: https://www.yasomi.com.tr' -H 'Access-Control-Request-Method: POST' $B/api/purchase | grep -ci '^access-control-allow-origin: https://www.yasomi.com.tr')" 1
check "yasomi.net Host -> 200 (yönlenmez)" "$(code -H 'Host: yasomi.net' $B/)" 200
check "www.yasomi.net -> apex 301" "$(loc -H 'Host: www.yasomi.net' "$B/a?b=1" | sed 's#^https\{0,1\}://##')" "yasomi.net/a?b=1"
curl -s -b $CK $B/admin/settings > $J
grep -q '<code>yasomi.net/ig</code>' $J && ok "ayarlar: yasomi.net/ig" || no "ayarlar yasomi.net/ig" "$(grep -o '<code>[^<]*/ig</code>' $J)"
grep -q 'data-copy="https://yasomi.net/ig"' $J && ok "ayarlar: kopyala https://yasomi.net/ig" || no "ayarlar kopyala" "?"
grep -q "fetch(&#39;https://yasomi.net/api/purchase&#39;\|fetch('https://yasomi.net/api/purchase'" $J && ok "ayarlar: Ticimax betiği yasomi.net" || no "Ticimax betiği" "$(grep -o 'fetch([^,]*' $J | head -2)"
grep -q 'isailetisim.com/api/purchase adresi de çalışmaya devam eder' $J && ok "ayarlar: eski uç not" || no "eski uç not" "?"
check "ayarlar: eski alan adı adres olarak geçmiyor" "$(grep -o 'https\{0,1\}://isailetisim.com[^ <\"&]*' $J | grep -vc 'isailetisim.com/api/purchase')" 0
curl -s -b $CK $B/admin > $J
grep -q '<span class="dom">yasomi.net</span>' $J && ok "/admin: başlık yasomi.net" || no "/admin dom" "$(grep -o '<span class="dom">[^<]*' $J)"
grep -q 'data-copy="https://yasomi.net/i/test"' $J && ok "/admin: kopyala https://yasomi.net/i/test" || no "/admin kopyala" "$(grep -o 'data-copy="[^"]*/i/test"' $J)"
check "/admin/new önizleme yasomi.net" "$(curl -s -b $CK $B/admin/new | grep -c 'https://yasomi.net/i/')" 2
check "/admin/ziyaretciler metni yasomi.net" "$(curl -s -b $CK $B/admin/ziyaretciler | grep -c 'Bio sayfasının (yasomi.net)')" 1
check "statik canonical yasomi.net" "$(curl -s $B/ | grep -c '<link rel="canonical" href="https://yasomi.net/">')" 1
check "robots.txt sitemap yasomi.net" "$(curl -s $B/robots.txt | grep -c 'Sitemap: https://yasomi.net/sitemap.xml')" 1

# 11) Şifre kasası (/admin/kasa): ikinci kilit, şifreli saklama, göster, indir
q "DELETE FROM vault_entries; DELETE FROM vault_audit; DELETE FROM login_attempts" >/dev/null
VPW='Kasa-Test-Sifre!42'
H=$(curl -s -b $CK -D - -o $J $B/admin/kasa)
check "kasa kilitli sayfa 200" "$(echo "$H" | head -1 | awk '{print $2}')" 200
check "kasa kilitli metni" "$(grep -c '<h1>Kasa kilitli</h1>' $J)" 1
echo "$H" | grep -i '^content-security-policy:' | grep -q "script-src 'nonce-" && ok "kasa CSP nonce" || no "kasa CSP" "$(echo "$H" | grep -i content-security)"
N=$(echo "$H" | grep -i '^content-security-policy:' | grep -o "nonce-[A-Za-z0-9+/=]*" | cut -d- -f2)
check "betikler nonce'lu" "$(grep -o '<script[^>]*>' $J | grep -vc "nonce=\"$N\"")" 0
check "kilitliyken yeni kayıt POST -> 403" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" -d 'title=X&password=y' $B/admin/kasa/yeni)" 403
check "kilitliyken JSON hata" "$(curl -s -b $CK -X POST -H "Origin: $B" $B/admin/kasa/indir | grep -c '"error":"locked"')" 1
check "kilitliyken kayıt yazılmadı" "$(q 'SELECT COUNT(*) FROM vault_entries')" 0
check "kasa yanlış şifre -> 401" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" -d 'password=yanlis' $B/admin/kasa/ac)" 401
H=$(curl -s -b $CK -c $CK -D - -o /dev/null -X POST -H "Origin: $B" --data-urlencode "password=$PW" -d 'next=/admin/kasa' $B/admin/kasa/ac)
check "kasa aç -> 303" "$(echo "$H" | head -1 | awk '{print $2}')" 303
echo "$H" | grep -i '^set-cookie:' | grep -q 'yvault=v1\..*Max-Age=900; Path=/admin/kasa; HttpOnly; Secure; SameSite=Strict' && ok "yvault çerezi 15 dk" || no "yvault" "$(echo "$H" | grep -i set-cookie)"
check "açık kasa listesi" "$(curl -s -b $CK $B/admin/kasa | grep -c 'Kasa açık · 15 dakika sonra kendini kilitler')" 1
check "boş kasa durumu" "$(curl -s -b $CK $B/admin/kasa | grep -c 'İlk kaydı ekle')" 1
check "yeni kayıt formu 200" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/kasa/yeni)" 200
check "başlıksız kayıt -> 400" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" -d 'title=&password=x' $B/admin/kasa/yeni)" 400
check "geçersiz URL -> 400" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" -d 'title=X&url=javascript%3Aalert(1)&password=x' $B/admin/kasa/yeni)" 400
check "hatalı formda şifre geri gelmez" "$(curl -s -b $CK -X POST -H "Origin: $B" -d 'title=&password=GeriGelmesin' $B/admin/kasa/yeni | grep -c 'GeriGelmesin')" 0
check "kayıt ekle -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" --data-urlencode 'title=Trendyol <b>Satıcı</b>' -d 'url=partner.trendyol.com&username=yasomi&email=info%40yasomi.com.tr&phone=0532&category=pazaryeri' --data-urlencode "password=$VPW" --data-urlencode 'note=2FA Mirza telefonunda' $B/admin/kasa/yeni)" 303
check "kayıt sayısı" "$(q 'SELECT COUNT(*) FROM vault_entries')" 1
check "DB'de şifre düz metin değil" "$(q "SELECT COUNT(*) FROM vault_entries WHERE password_enc LIKE '%Kasa-Test%' OR note_enc LIKE '%2FA%'")" 0
check "URL https eklendi" "$(q 'SELECT url FROM vault_entries')" "https://partner.trendyol.com/"
UID_=$(q 'SELECT uid FROM vault_entries')
curl -s -b $CK $B/admin/kasa > $J
check "listede şifre YOK" "$(grep -c -- "$VPW" $J)" 0
check "listede not YOK" "$(grep -c '2FA Mirza' $J)" 0
grep -q 'Trendyol &lt;b&gt;Satıcı&lt;/b&gt;' $J && ok "kasa başlığı kaçışlandı" || no "kasa kaçış" "?"
grep -q "data-uid=\"$UID_\"" $J && ok "kart listede" || no "kart" "?"
G=$(curl -s -b $CK -X POST -H "Origin: $B" $B/admin/kasa/$UID_/goster)
echo "$G" | grep -q "\"password\":\"$VPW\"" && ok "goster JSON şifreyi döner" || no "goster" "$G"
echo "$G" | grep -q '"note":"2FA Mirza telefonunda"' && ok "goster notu döner" || no "goster not" "$G"
check "goster audit" "$(q "SELECT COUNT(*) FROM vault_audit WHERE action='reveal'")" 1
check "düzenle formunda şifre yok" "$(curl -s -b $CK $B/admin/kasa/$UID_ | grep -c -- "$VPW")" 0
check "düzenle: boş şifre -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" -d 'title=Trendyol&url=&category=pazaryeri&password=&note=yeni+not' $B/admin/kasa/$UID_)" 303
G=$(curl -s -b $CK -X POST -H "Origin: $B" $B/admin/kasa/$UID_/goster)
echo "$G" | grep -q "\"password\":\"$VPW\"" && echo "$G" | grep -q '"note":"yeni not"' && ok "boş şifre aynı kaldı, not güncellendi" || no "düzenle" "$G"
curl -s -b $CK -D $J.h -o $J -X POST -H "Origin: $B" $B/admin/kasa/indir
grep -qi "content-disposition: attachment; filename=\"yasomi-sifreler-[0-9-]*\.txt\"" $J.h && ok "indir Content-Disposition" || no "indir başlık" "$(grep -i content-disp $J.h)"
grep -qi 'content-type: text/plain; charset=utf-8' $J.h && ok "indir text/plain" || no "indir tür" "$(grep -i content-type $J.h)"
grep -q -- "  Şifre      : $VPW" $J && ok "indir şifreyi içerir" || no "indir şifre" "$(head -12 $J)"
grep -q '=== Pazaryeri ===' $J && ok "indir kategori başlığı" || no "indir kategori" "?"
check "export audit" "$(q "SELECT COUNT(*) FROM vault_audit WHERE action='export'")" 1
check "bilinmeyen uid -> 404" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' $B/admin/kasa/0000000000000000)" 404
H=$(curl -s -b $CK -c $CK -D - -o /dev/null -X POST -H "Origin: $B" $B/admin/kasa/kilitle)
echo "$H" | grep -i '^set-cookie:' | grep -q 'yvault=; Max-Age=0' && ok "kilitle çerezi siler" || no "kilitle" "$(echo "$H" | grep -i set-cookie)"
check "kilitledikten sonra tekrar kilitli" "$(curl -s -b $CK $B/admin/kasa | grep -c '<h1>Kasa kilitli</h1>')" 1
check "kilitliyken goster -> 403" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" $B/admin/kasa/$UID_/goster)" 403
curl -s -b $CK -c $CK -o /dev/null -X POST -H "Origin: $B" --data-urlencode "password=$PW" $B/admin/kasa/ac
check "sil -> 303" "$(curl -s -b $CK -o /dev/null -w '%{http_code}' -X POST -H "Origin: $B" $B/admin/kasa/$UID_/sil)" 303
check "silindi" "$(q 'SELECT COUNT(*) FROM vault_entries')" 0
check "audit: unlock 2, create 1, update 1, delete 1" "$(q "SELECT SUM(action='unlock') || '/' || SUM(action='create') || '/' || SUM(action='update') || '/' || SUM(action='delete') FROM vault_audit")" "2/1/1/1"
H=$(curl -s -b $CK -D - -o /dev/null $B/admin)
echo "$H" | grep -i '^content-security-policy:' | grep -q "script-src 'nonce-" && ok "CSP tüm panelde" || no "panel CSP" "?"
H=$(curl -s -b $CK -c $CK -D - -o /dev/null -X POST $B/admin/logout)
echo "$H" | grep -i '^set-cookie:' | grep -q 'yvault=; Max-Age=0' && ok "çıkış yvault'ı da siler" || no "çıkış yvault" "$(echo "$H" | grep -i set-cookie)"
curl -s -b $CK -c $CK -o /dev/null -X POST --data-urlencode "password=$PW" $B/admin/login

check "çıkış -> 303" "$(curl -s -b $CK -c $CK -o /dev/null -w '%{http_code}' -X POST $B/admin/logout)" 303
check "çıkıştan sonra giriş sayfası" "$(curl -s -b $CK $B/admin | grep -c 'name="password"')" 1

rm -f $J $J.code $J.h $CK
echo "---- $pass geçti, $fail kaldı"
[ $fail = 0 ]
