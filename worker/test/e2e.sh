#!/usr/bin/env bash
# Yerel uçtan uca test. Önce: npx wrangler d1 migrations apply isailetisim --local && npx wrangler dev --local --port 8788
# Kullanım: bash test/e2e.sh   (şifre/anahtar .dev.vars'tan okunur)
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
grep -q 'http://localhost:8788/i/test\|https://isailetisim.com/i/test' $J && ok "detay: link" || no "detay link" "?"
grep -q '>trendyol<' $J && ok "detay: hedef tablosu trendyol" || no "hedef tablosu" "?"
grep -q 'Instagram in-app' $J && ok "detay: tarayıcı kırılımı" || no "tarayıcı" "?"
grep -q '#TY-55' $J && ok "detay: olay kaydında sipariş" || no "olay kaydı" "?"
grep -q '<svg class="d" viewBox' $J && grep -q '<svg class="m" viewBox' $J && ok "detay: SVG grafik (90g + mobil 30g)" || no "grafik" "?"
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
check "çıkış -> 303" "$(curl -s -b $CK -c $CK -o /dev/null -w '%{http_code}' -X POST $B/admin/logout)" 303
check "çıkıştan sonra giriş sayfası" "$(curl -s -b $CK $B/admin | grep -c 'name="password"')" 1

rm -f $J $J.code $J.h $CK
echo "---- $pass geçti, $fail kaldı"
[ $fail = 0 ]
