# isailetisim · influencer takibi

`isailetisim.com` bio sayfasını sunan ve influencer linklerini sayan Cloudflare Worker.
Veritabanı D1. Panel `/admin`. Derleme adımı yok, framework yok.

## Ne yapar

| Yol | İş |
|---|---|
| `/i/<kod>` | Ziyaret yazar, `yref` çerezini 30 gün koyar, hedefe 302 ile yollar. Kısa biçim `/<kod>` da çalışır (yalnız kod varsa). |
| `POST /api/click` | Bio sayfasındaki her dış tıklamayı yazar (Trendyol, Hepsiburada, site…). |
| `POST /api/purchase` | Siteden satın alma bildirimi (`X-Postback-Key` gerekir). |
| `/admin` | Türkçe panel: genel bakış, yeni link, influencer detayı, CSV, elle satış girişi, ayarlar. |
| geri kalan her şey | `../` klasöründeki statik bio sitesi (`index.html`, `assets/`). Olmayan yol 404. |

Dosyalar: `src/index.js` yönlendirici · `src/track.js` takip uçları · `src/admin.js` panel ·
`src/db.js` SQL · `src/html.js` şablon ve stil · `src/auth.js` giriş/oturum · `src/util.js` yardımcılar ·
`src/snippets.js` Ticimax betiği · `migrations/0001_init.sql` şema (`schema.sql` aynısı) ·
`bio-snippet.html` index.html'e eklenecek betik · `test/` testler.

## Canlıya alma (bir kez)

Komutların hepsi `worker/` klasöründe çalışır.

1. Giriş: `npx wrangler login` **ya da** `export CLOUDFLARE_API_TOKEN=...` (Workers + D1 + DNS yetkili token).
2. Veritabanı: `npx wrangler d1 create isailetisim`. Çıktıdaki `database_id` değerini `wrangler.toml` içindeki
   `00000000-...` yerine yapıştır.
3. Şema: `npx wrangler d1 migrations apply isailetisim --remote`
4. Sırlar (her biri sorulunca değeri yaz):
   ```
   npx wrangler secret put ADMIN_PASSWORD     # panel şifresi
   npx wrangler secret put SESSION_SECRET     # uzun rastgele dizi: openssl rand -hex 32
   npx wrangler secret put PURCHASE_KEY       # postback anahtarı: openssl rand -hex 16
   ```
5. Alan adı: `isailetisim.com` zone'u Cloudflare hesabında olmalı. `wrangler.toml` içindeki satırı aç:
   `routes = [{ pattern = "isailetisim.com", custom_domain = true }]`.
   Şu an site GitHub Pages'te (`CNAME` dosyası). Apex'te GitHub Pages A kayıtları duruyorsa custom domain
   oluşmaz; önce o kayıtları sil.
6. Yayın: `npx wrangler deploy`. Sonra `https://isailetisim.com/admin` aç, şifreyle gir.
7. `bio-snippet.html` içindeki betiği `index.html`'de `</body>`'den hemen önce yapıştır ve yayınla.

Sonraki her değişiklik: `npx wrangler deploy`. Yeni migration varsa önce 3. adım.

## Link oluşturma

Panel > **Yeni link**. İsim yaz; kod kendiliğinden önerilir (`Ayşe Kaya` → `ayse-kaya`), istersen değiştir.
Hedef:
- `/` bio sayfası (varsayılan).
- `/#h-products` gibi sayfa içi bölüm. Ürün kartına özel çapa (`/#urun-c11-pro`) index.html'de o `id` varsa çalışır.
- Tam URL (Trendyol ürün sayfası, yasomi.com.tr ürünü). Ziyaret yine yazılır, çerez yine konur, ziyaretçi oraya gider.
  yasomi.com.tr adreslerine otomatik `utm_content=<kod>` eklenir.

Kaydedince link çıkar: `https://isailetisim.com/i/<kod>` ve **Kopyala** düğmesi. Kod sonradan değişmez.
Bir influencer'la iş bitince **Pasifleştir**: link ana sayfaya gider, sayılmaz.

## Paneli okuma

- **Genel bakış**: üstte dört kutu. Büyük sayı son 30 gün; altında 7 gün ve tüm zamanlar. Yalnız influencer
  linkiyle gelenler sayılır; ref'siz tıklama ve satış altta ayrı yazılır. Tabloda 7 gün / 30 gün / Tümü düğmesi
  sütunları değiştirir; başlığa tıklayınca sıralar.
- **CTR** = tıklama / ziyaret. Influencer'ın getirdiği kişi mağazaya geçiyor mu, onu gösterir.
- **Influencer detayı**: 90 günlük grafik (telefonda 30 gün), günlük tablo (boş günler dahil), tıklama hedefleri
  (hangi mağaza), cihaz ve tarayıcı (Instagram/TikTok uygulama içi tarayıcı ayrı görünür), konum, olay kaydı
  (sayfa başı 100), **CSV indir** (tüm olaylar, Excel'de doğrudan açılır).
- **Satın alma ekle**: pazaryeri satışını elle gir (tarih, kaynak, tutar, sipariş no). Yanlış girdiğini olay
  kaydındaki **Sil** ile kaldır.
- Saatler İstanbul saatidir.

## Neler atanabilir, neler atanamaz

| Durum | Atanır mı |
|---|---|
| `/i/<kod>` ziyareti | Evet, otomatik. Link önizleme botları (WhatsApp, Facebook, Telegram…) sayılmaz. Aynı kişi 30 sn içinde tekrar gelirse tek sayılır. |
| Bio sayfasından mağazaya tıklama | Evet, `bio-snippet.html` yayındaysa. 30 gün boyunca çerez/ref ile influencer'a yazılır. |
| yasomi.com.tr'de satın alma | Ticimax betiği kuruluysa evet (aşağıda). Kurulmadıysa yalnız elle. |
| Trendyol, Hepsiburada, Amazon, Pazarama, Temu satışı | **Hayır, otomatik değil.** Pazaryerleri dışarıya satış bilgisi vermez. Influencer kodu veya kampanya raporundan bildiğini panelden elle gir. |
| Kişi linke tıklamadan, influencer'ı görüp doğrudan mağazaya giderse | Hayır. Hiçbir link takibi bunu göremez. |

Not: Instagram ve TikTok uygulama içi tarayıcısı çerezi ayrı tutar. Kişi linki uygulamada açıp sonra Safari'den
satın alırsa bağ kopar. Sayılar alt sınır olarak okunmalı.

## Ticimax satın alma bildirimi

Uç nokta: `POST https://isailetisim.com/api/purchase`, başlık `X-Postback-Key: <PURCHASE_KEY>`, gövde JSON
`{ref, order_id, amount, currency:'TRY', source:'site', note}`. Aynı `order_id` + kaynak ikinci kez gelirse yok sayılır.

İki betik var. `PURCHASE_KEY_DEGERI` yerine kendi anahtarını yaz.

```html
<!-- 1) TÜM SAYFALAR (Ticimax: Tasarım > Script / Head alanı) -->
<script>
/* isailetisim influencer takibi: bio'dan gelen ziyaretçinin ref kodunu 30 gün sakla */
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var r = p.get('utm_content');
    // Bio sayfası ve /i/ linkleri yasomi.com.tr'ye utm_source=bio&utm_content=<kod> ile gelir
    if (r && p.get('utm_source') === 'bio' && /^[a-z0-9-]{1,40}$/.test(r)) {
      localStorage.setItem('yref', JSON.stringify({ r: r, t: Date.now() })); // son tıklayan kazanır
    }
  } catch (e) {}
})();
</script>
```

```html
<!-- 2) YALNIZ SİPARİŞ TAMAMLANDI SAYFASI (Ticimax: sipariş sonu / dönüşüm kodu alanı) -->
<script>
/* Influencer'dan gelen siparişi isailetisim paneline bildir */
window.addEventListener('load', function () {
  setTimeout(function () {
    try {
      var s = JSON.parse(localStorage.getItem('yref') || 'null');
      if (!s || Date.now() - s.t > 30 * 864e5) return; // influencer'dan gelmeyen sipariş gönderilmez

      // Sipariş no + tutar: GA4 dataLayer 'purchase' olayından okunur.
      // DOĞRULA: Ticimax'ta GA4 e-ticaret açık değilse bu blok boş döner; o zaman
      // sipariş no ve tutarı sayfadaki kendi değişkenlerinden okuyacak şekilde değiştir.
      var dl = window.dataLayer || [], o = null;
      for (var i = dl.length - 1; i >= 0; i--) {
        var e = dl[i];
        if (e && e.event === 'purchase' && e.ecommerce) { o = e.ecommerce; break; }
      }
      if (!o || !o.transaction_id) return;

      var id = String(o.transaction_id);
      var k = 'yref_sent_' + id;           // sayfa yenilenirse aynı sipariş ikinci kez gitmesin
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');

      fetch('https://isailetisim.com/api/purchase', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-Postback-Key': 'PURCHASE_KEY_DEGERI' // wrangler secret put PURCHASE_KEY ile verdiğin değer
        },
        body: JSON.stringify({
          ref: s.r,
          order_id: id,
          amount: Number(o.value) || 0,
          currency: o.currency || 'TRY',
          source: 'site',
          note: 'ticimax'
        })
      });
    } catch (e) {}
  }, 1500); // dataLayer'ın dolmasını bekle
});
</script>
```

Doğrulanmamış iki nokta:
- Sipariş no ve tutar GA4 `dataLayer` `purchase` olayından okunuyor. Ticimax'ta GA4 e-ticaret açık değilse
  betik sessizce hiçbir şey göndermez; o zaman sipariş sayfasındaki değişkenlere göre düzenlemek gerekir.
  İlk gerçek siparişten sonra panelde satırın düştüğünü kontrol et.
- Anahtar tarayıcı betiğinde durduğu için sayfa kaynağında görünür. Rastgele çöp isteği keser, kararlı birini
  kesmez. Şüpheli satırı panelden sil; gerekirse `wrangler secret put PURCHASE_KEY` ile anahtarı değiştir.

Elle test:
```
curl -X POST https://isailetisim.com/api/purchase \
  -H 'Content-Type: application/json' -H 'X-Postback-Key: <anahtar>' \
  -d '{"ref":"ayse-kaya","order_id":"TEST-1","amount":5999,"currency":"TRY","source":"site","note":"test"}'
```

## Kişisel veri (KVKK)

Ham IP saklanmaz. `ip_hash = SHA-256(ip + SESSION_SECRET)` ilk 16 karakter; yalnız tekilleştirme ve giriş
denemesi sınırı için. Tarayıcı kimliği (UA) 300 karaktere kırpılır, referer yalnız alan adı olarak tutulur.
`SESSION_SECRET` değişirse eski hash'ler eşleşmez (sorun değil, yalnız 30 sn'lik tekilleştirme etkilenir) ve
tüm panel oturumları düşer.

## Güvenlik

- Panel: tek şifre (`ADMIN_PASSWORD`), HMAC imzalı 7 günlük çerez (`HttpOnly; Secure; SameSite=Lax; Path=/admin`).
  Şifre değişince açık oturumlar da düşer.
- Giriş denemesi: IP başına 10 dakikada 10 deneme; 11.'si 429.
- Panel formları başka siteden gönderilemez (Origin kontrolü + SameSite çerez).
- Kullanıcıdan gelen her metin HTML'de kaçışlanır.

## Yerel geliştirme

```
npm install
cp .dev.vars.example .dev.vars          # yerel şifre/anahtarlar
npx wrangler d1 migrations apply isailetisim --local
npx wrangler dev --local --port 8788    # http://localhost:8788/admin
npm test                                # saf mantık testleri (Cloudflare gerekmez)
bash test/e2e.sh                        # dev sunucusu açıkken uçtan uca test (yerel veritabanını sıfırlar)
```
