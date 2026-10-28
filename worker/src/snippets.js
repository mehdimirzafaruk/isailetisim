// Ayarlar sayfasında ve README'de gösterilen Ticimax betikleri (tek kaynak).

export function ticimaxSnippets(origin = 'https://isailetisim.com') {
  const allPages = `<!-- 1) TÜM SAYFALAR (Ticimax: Tasarım > Script / Head alanı) -->
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
</script>`;

  const orderPage = `<!-- 2) YALNIZ SİPARİŞ TAMAMLANDI SAYFASI (Ticimax: sipariş sonu / dönüşüm kodu alanı) -->
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

      fetch('${origin}/api/purchase', {
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
</script>`;
  return { allPages, orderPage };
}
