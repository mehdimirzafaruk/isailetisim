# isailetisim · influencer takibi

`yasomi.net` bio sayfasını sunan ve influencer linklerini sayan Cloudflare Worker (eski adres `isailetisim.com`, aşağıda **Alan adı yasomi.net**).
Veritabanı D1. Panel `/admin`. Derleme adımı yok, framework yok.

## Ne yapar

| Yol | İş |
|---|---|
| `/i/<kod>` | Ziyaret yazar, `yref` çerezini 30 gün koyar, hedefe 302 ile yollar. Kısa biçim `/<kod>` da çalışır (yalnız kod varsa). |
| `POST /api/click` | Bio sayfasındaki her dış tıklamayı yazar (Trendyol, Hepsiburada, site…). |
| `POST /api/purchase` | Siteden satın alma bildirimi (`X-Postback-Key` gerekir). |
| `/` | Bio sayfası. Her açılış arkada `view` olayı olarak yazılır (aşağıda **Ziyaretçi sayacı**). |
| `/ig` `/tt` `/fb` `/x` `/yt` `/ln` `/wa` `/tg` | Kanal linki: 302 ile `/?s=<kısa>`'ya gider; ziyaret o kanala yazılır. |
| `/admin` | Türkçe panel: genel bakış, ziyaretçiler, yeni link, influencer detayı, CSV, elle satış girişi, ayarlar. |
| `/admin/kasa` | Şifre kasası: ekibin platform şifreleri, AES-256-GCM ile şifreli; ayrı 15 dk kilit (aşağıda **Şifre kasası**). |
| geri kalan her şey | `../` klasöründeki statik bio sitesi (`index.html`, `assets/`). Olmayan yol 404. |

Dosyalar: `src/index.js` yönlendirici · `src/track.js` takip uçları · `src/admin.js` panel ·
`src/db.js` SQL · `src/html.js` şablon ve stil · `src/auth.js` giriş/oturum/kasa kilidi · `src/vault.js` şifre kasası · `src/util.js` yardımcılar ·
`src/sources.js` ziyaret kaynağı tespiti · `src/snippets.js` Ticimax betiği · `migrations/` şema
(`schema.sql` migration'ların sonucu) · `bio-snippet.html` index.html'e eklenecek betik · `test/` testler
(`test/seed.sql` yerel örnek veri).

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
   npx wrangler secret put VAULT_KEY          # şifre kasası anahtarı: openssl rand -base64 32 (aşağıda Şifre kasası)
   ```
5. Alan adı: `yasomi.net` ve (eski) `isailetisim.com` zone'ları Cloudflare hesabında olmalı. `wrangler.toml` içindeki
   `routes` dördünü de custom domain olarak tanımlar (apex + www, iki alan adı). Apex'te başka A/CNAME kaydı
   duruyorsa custom domain oluşmaz; önce o kayıtları sil.
6. Yayın: `npx wrangler deploy`. Sonra `https://yasomi.net/admin` aç, şifreyle gir.
7. `bio-snippet.html` içindeki betiği `index.html`'de `</body>`'den hemen önce yapıştır ve yayınla.

Sonraki her değişiklik: `npx wrangler deploy`. Yeni migration varsa önce 3. adım.

**0002_views (ziyaretçi sayacı) için sıra önemli:** önce `npx wrangler d1 migrations apply isailetisim --remote`,
sonra `npx wrangler deploy`. Ters sırada yeni kod `view` yazmaya çalışır, eski CHECK kısıtı reddeder; hata yalnız
loglara düşer, sayfa yine açılır, ama o aradaki ziyaretler kaybolur.

## Alan adı yasomi.net (28 Ekim 2026)

- Kanonik adres `https://yasomi.net`. Panel linkleri (`/i/<kod>`), kanal linkleri (`/ig`, `/tt`…), Ayarlar'daki Ticimax
  betiği ve curl örneği bu adresle gösterilir. `index.html` canonical/OG, `sitemap.xml` ve `robots.txt` de yasomi.net.
- `isailetisim.com` ve `www.isailetisim.com`: `/api/*` dışındaki her istek aynı yol ve sorguyla `https://yasomi.net`'e
  **301** gider (eski bio ve `/i/<kod>` linkleri çalışır; çerez yasomi.net'te normal akışla konur). `/api/*` yönlendirilmez,
  iki alan adında da aynı işlenir: canlı Ticimax betiği hâlâ `https://isailetisim.com/api/purchase`'a gönderiyor.
  `www.yasomi.net` → `yasomi.net` (301).
- Eski alan adındaki panel oturumu taşınmaz (çerez alan adına bağlı); yasomi.net/admin'de bir kez yeniden giriş yap.
  "Beni sayma" çerezi de yeni alan adında bir kez daha basılmalı.
- Adresi değiştirmek: `wrangler.toml` > `[vars]` > `SITE_ORIGIN = "https://yasomi.net"` (sonda `/` yok), sonra
  `npx wrangler deploy`. Değer yoksa ya da bozuksa kod `https://yasomi.net` kullanır. Eski alan adları listesi
  `src/util.js` > `LEGACY_HOSTS`. `index.html`, `sitemap.xml`, `robots.txt` statik; onları elle değiştir.
- Ticimax'taki betiği yasomi.net'e çevirmek zorunlu değil; çevirirsen Ayarlar sayfasındaki güncel bloğu yapıştır.

## Link oluşturma

Panel > **Yeni link**. İsim yaz; kod kendiliğinden önerilir (`Ayşe Kaya` → `ayse-kaya`), istersen değiştir.
Hedef:
- `/` bio sayfası (varsayılan).
- `/#h-products` gibi sayfa içi bölüm. Ürün kartına özel çapa (`/#urun-c11-pro`) index.html'de o `id` varsa çalışır.
- Tam URL (Trendyol ürün sayfası, yasomi.com.tr ürünü). Ziyaret yine yazılır, çerez yine konur, ziyaretçi oraya gider.
  yasomi.com.tr adreslerine otomatik `utm_content=<kod>` eklenir.

Kaydedince link çıkar: `https://yasomi.net/i/<kod>` ve **Kopyala** düğmesi. Kod sonradan değişmez.
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

## Ziyaretçi sayacı

Panel > **Ziyaretçiler** (`/admin/ziyaretciler`) ve Genel bakış'ın üstündeki dört kutu: bio sayfasını kaç kişinin
açtığı, nereden geldiği, kaçının mağazaya tıkladığı.

**Ne sayılır.** `GET /` isteği sayfa sunulduktan sonra arkada (`ctx.waitUntil`) `view` olayı olarak yazılır;
sayfa bir milisaniye bile beklemez. Tarayıcı önbellekten tekrar doğrularsa (304) o da açılış sayılır.
Sayılmayanlar: botlar ve link önizlemeleri (WhatsApp, Facebook, Telegram…, `curl`, headless tarayıcılar, UA'sız
istekler), tarayıcı ön yüklemesi (`Sec-Purpose: prefetch`), `HEAD`, `/assets/...` dosyaları, aynı ip_hash'in 30 sn
içindeki ikinci açılışı (kaynağı farklı olsa da) ve `ynoview=1` çerezi olan tarayıcı.

- **Ziyaret**: açılış sayısı. **Tekil ziyaretçi**: farklı `ip_hash` sayısı (aynı Wi-Fi'deki iki telefon tek görünür,
  mobil veride IP değişen kişi iki görünebilir; yaklaşık bir sayıdır).
- **Tıklama**: bio sayfasından mağazaya geçiş (`/api/click`). **Tıklama oranı** = tıklama / ziyaret.
- Kaynak tablosundaki tıklama: aynı ip_hash'in tıklamadan önceki **son 1 saatteki** en yeni ziyaretinin kaynağına
  yazılır. Eşleşen ziyaret yoksa "Eşleşmeyen tıklama" satırına düşer.

**Kaynak nasıl bulunur** (`events.target`, ilk tutan kazanır):
1. `?s=` etiketi: `ig tt fb x yt ln wa tg` → instagram, tiktok, facebook, x, youtube, linkedin, whatsapp, telegram.
   Başka değer → `s:<etiket>` (Türkçe harfler sadeleşir, en çok 20 karakter): `/?s=kasim-cekilis` → "Etiket: kasim-cekilis".
2. `?ref=<kod>` (influencer linki `/i/<kod>` buraya yollar) ve kod kayıtlıysa → `influencer`, `code` dolar.
   Influencer detayındaki "Sayfa görüntüleme (landing)" bunu sayar.
3. Referer alan adı: instagram.com, tiktok.com, facebook.com, t.co/x.com/twitter.com, youtube.com/youtu.be,
   linkedin.com/lnkd.in, google.*, whatsapp.com/wa.me, t.me/telegram.org; Android uygulama referer'ı
   (`android-app://com.instagram.android`) da tanınır. Başka site → `web:<alan adı>` ("Diğer web"). Kendi alan adımız yok sayılır.
4. Uygulama içi tarayıcı: Instagram, TikTok, Facebook (ve X) tarayıcısının UA'sı.
5. Hiçbiri yoksa `direkt`.

Ham referer alan adı ayrıca `events.referer`'da durur.

**Kanal linkleri.** Her platformun bio'suna kendi linkini koy (Ayarlar'da kopyala düğmeli liste var):

| Link | Kaynak |
|---|---|
| `https://yasomi.net/ig` | Instagram |
| `https://yasomi.net/tt` | TikTok |
| `https://yasomi.net/fb` | Facebook |
| `https://yasomi.net/x` | X |
| `https://yasomi.net/yt` | YouTube |
| `https://yasomi.net/ln` | LinkedIn |
| `https://yasomi.net/wa` | WhatsApp |
| `https://yasomi.net/tg` | Telegram |

Bu kodlar (ve `admin`, `api`, `assets`, `i`) influencer kodu olarak verilemez.

**Kendini sayma.** Ayarlar > **Beni sayma**: `ynoview=1` çerezi (1 yıl, `Path=/`, apex alan adı). O tarayıcıdan bio
açılışları ve mağaza tıklamaları yazılmaz. **Tekrar say** çerezi siler. Çerez tarayıcıya özeldir: Instagram/TikTok
uygulamasının kendi tarayıcısında da sayılmamak için paneli orada açıp bir kez daha bas.

**Sınırlar.**
- Uygulama içi tarayıcılar referer'ı çoğu zaman göndermez; Instagram/TikTok/Facebook yine UA'dan tanınır ama
  WhatsApp, Telegram, YouTube gibi uygulamalardan gelen etiketsiz ziyaret "Direkt" görünebilir. Kesin sayı için kanal linki kullan.
- Kişi linki kopyalayıp Safari'ye yapıştırırsa referer ve UA ipucu kaybolur → "Direkt" (etiketli linkte `?s=` kalır).
- Ülke ve şehir Cloudflare'in `request.cf` / `cf-ipcountry` bilgisinden gelir; şehir IP tabanlı tahmindir, mobil
  operatörde çoğu zaman operatörün merkezi (genelde İstanbul) görünür. Yerel geliştirmede boştur.
- Reklam engelleyiciler bu sayacı engellemez (sunucu tarafı), ama tıklama betiğini engelleyebilir; tıklama oranı alt sınırdır.
- Saatler İstanbul saatidir (UTC+3).

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

Uç nokta: `POST https://yasomi.net/api/purchase` (eski `https://isailetisim.com/api/purchase` da çalışır), başlık `X-Postback-Key: <PURCHASE_KEY>`, gövde JSON
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

      fetch('https://yasomi.net/api/purchase', {
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
- Sipariş no ve tutar Ticimax yer tutucularından ({SIPARISNO}, {SIPARISTOPLAMTUTAR}) okunuyor; 28 Ekim 2026'da canlıya kuruldu. (Eski not: GA4 dataLayer'a bağımlı değil.) Ticimax'ta GA4 e-ticaret açık değilse
  betik sessizce hiçbir şey göndermez; o zaman sipariş sayfasındaki değişkenlere göre düzenlemek gerekir.
  İlk gerçek siparişten sonra panelde satırın düştüğünü kontrol et.
- Anahtar tarayıcı betiğinde durduğu için sayfa kaynağında görünür. Rastgele çöp isteği keser, kararlı birini
  kesmez. Şüpheli satırı panelden sil; gerekirse `wrangler secret put PURCHASE_KEY` ile anahtarı değiştir.

Elle test:
```
curl -X POST https://yasomi.net/api/purchase \
  -H 'Content-Type: application/json' -H 'X-Postback-Key: <anahtar>' \
  -d '{"ref":"ayse-kaya","order_id":"TEST-1","amount":5999,"currency":"TRY","source":"site","note":"test"}'
```

## Kişisel veri (KVKK)

Ham IP saklanmaz. `ip_hash = SHA-256(ip + SESSION_SECRET)` ilk 16 karakter; yalnız tekilleştirme ve giriş
denemesi sınırı için. Tarayıcı kimliği (UA) 300 karaktere kırpılır, referer yalnız alan adı olarak tutulur.
`SESSION_SECRET` değişirse eski hash'ler eşleşmez (sorun değil, yalnız 30 sn'lik tekilleştirme etkilenir) ve
tüm panel oturumları düşer.

## Şifre kasası (/admin/kasa)

Ekibin bütün şifreleri tek yerde: pazaryeri panelleri, sosyal hesaplar, reklam hesapları, mail, banka/ödeme,
sunucu/alan adı. Kayıt alanları: platform/site adı, URL, kullanıcı adı, e-posta, telefon, şifre, kategori, not.
Panelde **Kasa** sekmesi.

**Nasıl korunur**

- Şifre ve not **AES-256-GCM** ile şifreli saklanır (`vault_entries.password_enc`, `note_enc`). Her alan kendi rastgele
  12 baytlık IV'siyle şifrelenir; kaydın `uid`'i ek doğrulama verisi (AAD) olarak bağlıdır, şifreli metin başka satıra
  kopyalanırsa çözülmez. Başlık, URL, kullanıcı adı, e-posta, telefon aramada kullanıldığı için düz metin.
- Anahtar Worker secret'ı `VAULT_KEY` (32 bayt, base64). Kodda, D1'de, git'te yok. Tanımlı değilse kasa sayfaları
  503 "Kurulum eksik: VAULT_KEY" verir; panelin geri kalanı çalışır.
- **İkinci kilit:** panel oturumu 7 gün sürer, kasa ayrıca panel şifresini tekrar ister ve **15 dakika** açık kalır
  (`yvault` çerezi: HMAC imzalı, `Path=/admin/kasa; HttpOnly; Secure; SameSite=Strict`, süre uzamaz). Süre dolunca
  liste sayfası kendini yeniler ve kilit ekranına düşer. **Kilitle** düğmesi ve panelden çıkış kasayı hemen kilitler.
  `ADMIN_PASSWORD` ya da `VAULT_KEY` değişince açık kasalar kilitlenir.
- Kilit ekranında da giriş sayfasıyla aynı hız sınırı: IP başına 10 dakikada 10 deneme (sayaç ortak).
- Şifre ve not liste HTML'inde yoktur. **Göster** / **Şifreyi kopyala** ayrı bir POST ile alır; gösterilen şifre
  30 saniye sonra kendiliğinden gizlenir. Düzenleme formunda şifre alanı boş gelir (boş bırakılırsa aynı kalır).
- Hareket kaydı (`vault_audit`): kasa açma, ekleme, güncelleme, silme, gösterme/kopyalama, toplu indirme; zaman,
  kayıt başlığı ve IP özeti (ham IP yok). Son 15 hareket listenin altında **Son hareketler**'de.
- Panel sayfaları sıkı CSP ile gelir (betikler istek başına nonce'lu, `frame-ancestors 'none'`, `form-action 'self'`).
  Şifre ve not hiçbir yerde loglanmaz.

**Kurulum (bir kez)**

```
openssl rand -base64 32                          # çıkan değeri kopyala
security add-generic-password -a isailetisim -s panel-vault-key -w '<değer>'   # Mac anahtarlığına yedek
npx wrangler secret put VAULT_KEY                # sorulunca aynı değeri yapıştır
npx wrangler d1 migrations apply isailetisim --remote   # 0003_vault: önce şema
npx wrangler deploy                                     # sonra kod
```

Sıra önemli: önce migration, sonra deploy. Ters sırada kasa sayfaları tablo bulunamadı hatası verir (panelin geri
kalanı etkilenmez).

> **VAULT_KEY kaybolursa kasa geri gelmez.** Cloudflare secret'ı geri okunamaz; tek yedek Mac anahtarlığı:
> `security find-generic-password -a isailetisim -s panel-vault-key -w`
> Anahtarı değiştirmek (rotasyon) şifreli kayıtları okunmaz yapar: önce **Tümünü indir**, sonra yeni anahtar, sonra
> kayıtları yeniden gir. Toplu yeniden şifreleme aracı yok.

**Tümünü indir (.txt)**: bütün kayıtlar çözülmüş, kategoriye göre gruplu, başlığa göre sıralı düz metin
(`yasomi-sifreler-YYYY-MM-DD.txt`). Dosya şifresizdir: işin bitince sil, paylaşma. Her indirme hareket kaydına düşer.

| Rota | İş |
|---|---|
| `GET /admin/kasa` | Liste: arama, kategori çipleri, kartlar, son hareketler. Kilitliyse kilit ekranı. |
| `POST /admin/kasa/ac` | Kasayı aç (`password`, `next`); 15 dk `yvault` çerezi. |
| `POST /admin/kasa/kilitle` | Kasayı kilitle. |
| `GET/POST /admin/kasa/yeni` | Yeni kayıt formu (şifre **Üret**: 20 karakter, harf + rakam + sembol). |
| `GET/POST /admin/kasa/<uid>` | Düzenle. |
| `POST /admin/kasa/<uid>/sil` | Sil. |
| `POST /admin/kasa/<uid>/goster` | JSON `{ok, password, note}`. |
| `POST /admin/kasa/indir` | Tümünü düz metin indir. |

Kasa kilitliyken POST istekleri 403 JSON `{ok:false,error:"locked"}` alır (tarayıcı formu gönderdiyse kilit ekranına
303). Yerel testte `.dev.vars`'a `VAULT_KEY=<openssl rand -base64 32>` ekle.

## Güvenlik

- Panel: tek şifre (`ADMIN_PASSWORD`), HMAC imzalı 7 günlük çerez (`HttpOnly; Secure; SameSite=Lax; Path=/admin`).
  Şifre değişince açık oturumlar da düşer.
- Giriş denemesi: IP başına 10 dakikada 10 deneme; 11.'si 429.
- Panel formları başka siteden gönderilemez (Origin kontrolü + SameSite çerez).
- Kullanıcıdan gelen her metin HTML'de kaçışlanır.
- Panelin tüm HTML sayfalarında CSP: satır içi betikler istek başına nonce ister, başka kaynaktan betik yüklenmez.
- Şifre kasası ayrıca 15 dakikalık ikinci kilit ve AES-256-GCM kullanır (yukarıda **Şifre kasası**).

## Yerel geliştirme

```
npm install
cp .dev.vars.example .dev.vars          # yerel şifre/anahtarlar
npx wrangler d1 migrations apply isailetisim --local
npx wrangler dev --local --port 8788    # http://localhost:8788/admin
npm test                                # saf mantık testleri (Cloudflare gerekmez)
bash test/e2e.sh                        # dev sunucusu açıkken uçtan uca test (yerel veritabanını sıfırlar)
npx wrangler d1 execute isailetisim --local --file test/seed.sql   # yerel örnek veri: 2 influencer, ~300 olay, 20 gün
```
