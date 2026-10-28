// Ayarlar sayfasında ve README'de gösterilen Ticimax betikleri (tek kaynak).
// 28 Ekim 2026: canlıda Script Yönetimi > 'Tüm Sayfalar' ve 'Sipariş Tamamlandı' kayıtlarının sonunda bu bloklar var.
// Sipariş bloğu Ticimax yer tutucularını ({SIPARISNO}, {SIPARISTOPLAMTUTAR}, {PARABIRIMI}) kullanır; GA4 dataLayer'a bağımlı değildir.

export function ticimaxSnippets(origin = 'https://isailetisim.com') {
  const allPages = `<!-- 1) TÜM SAYFALAR (Ticimax: Script Yönetimi > Tüm Sayfalar, mevcut içeriğin sonuna) -->
<!-- isailetisim influencer takibi (28 Ekim 2026): bio'dan gelen ziyaretçinin kodunu 30 gün sakla -->
<script>
(function(){try{
  var p=new URLSearchParams(location.search), r=(p.get('utm_content')||'').toLowerCase();
  if(r && p.get('utm_source')==='bio' && /^[a-z0-9-]{1,40}$/.test(r)){
    localStorage.setItem('yref', JSON.stringify({r:r,t:Date.now()}));
  }
}catch(e){}})();
</script>`;

  const orderPage = `<!-- 2) YALNIZ SİPARİŞ TAMAMLANDI (Ticimax: Script Yönetimi > Sipariş Tamamlandı, mevcut içeriğin sonuna) -->
<!-- isailetisim influencer takibi (28 Ekim 2026): siparişi panele bildir (influencer kodu varsa onunla, yoksa organik) -->
<script>
(function(){try{
  var s=null; try{s=JSON.parse(localStorage.getItem('yref')||'null');}catch(_){}
  var ref=(s&&s.r&&Date.now()-s.t<=30*864e5)?s.r:'';
  var id=String('{SIPARISNO}'||'{SIPARISID}').trim();
  if(!id||id.charAt(0)==='{')return;
  var k='yref_sent_'+id; if(localStorage.getItem(k))return; localStorage.setItem(k,'1');
  function num(v){var t=String(v==null?'':v).trim().replace(/\\s/g,'').replace(/[^0-9,.-]/g,'');if(t.indexOf(',')!==-1){t=t.replace(/\\./g,'').replace(',','.');}var n=Number(t);return isFinite(n)?n:0;}
  var cur=String('{PARABIRIMI}'||'TRY').trim().toUpperCase(); if(cur==='TL'||cur==='₺'||cur.indexOf('T')===0)cur='TRY';
  var body=JSON.stringify({ref:ref,order_id:id,amount:num('{SIPARISTOPLAMTUTAR}'),currency:cur,source:'site',note:ref?'ticimax siparis sonu':'ticimax siparis sonu · organik'});
  fetch('${origin}/api/purchase',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Postback-Key':'PURCHASE_KEY_DEGERI'},body:body}).catch(function(){});
}catch(e){}})();
</script>`;
  return { allPages, orderPage };
}
