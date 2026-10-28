// isailetisim.com Worker: statik bio sitesi (Workers static assets) + influencer takibi + /admin paneli.
import * as track from './track.js';
import { handleAdmin } from './admin.js';
import { getInfluencer } from './db.js';
import { isValidCode, json } from './util.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    // www.isailetisim.com -> isailetisim.com (kalıcı yönlendirme)
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    try {
      // 1) Influencer linki (kanonik biçim)
      const im = p.match(/^\/i\/([^/]+)\/?$/);
      if (im && (request.method === 'GET' || request.method === 'HEAD')) {
        let code = im[1];
        try { code = decodeURIComponent(code); } catch { /* olduğu gibi */ }
        return track.influencerHit(request, env, ctx, code);
      }
      if (p === '/i' || p.startsWith('/i/')) return Response.redirect(url.origin + '/', 302);

      // 2) API
      if (p === '/api/click') return track.click(request, env, ctx);
      if (p === '/api/purchase') return track.purchase(request, env);
      if (p.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);

      // 3) Panel
      if (p === '/admin' || p.startsWith('/admin/')) return handleAdmin(request, env, ctx, url);

      // 4) Kanal kısa linkleri: /ig -> /?s=ig (bio'lara yapıştırılır)
      const cm = p.match(/^\/([a-z]{1,2})\/?$/i);
      if (cm && (request.method === 'GET' || request.method === 'HEAD')) {
        const r = track.channelRedirect(cm[1].toLowerCase());
        if (r) return r;
      }

      // 5) Önce statik dosya (run_worker_first = true olduğu için her istek buradan geçer)
      let assetRes = null;
      if (env.ASSETS) {
        assetRes = await env.ASSETS.fetch(request);
        // Bio sayfası görüntülemesi: yanıt hemen döner, yazma arkada (waitUntil). 304 = tarayıcı önbelleğinden tekrar açılış.
        if ((p === '/' || p === '/index.html') && request.method === 'GET' && (assetRes.status === 304
          || (assetRes.status === 200 && (assetRes.headers.get('content-type') || '').includes('text/html')))) {
          ctx.waitUntil(track.pageView(request, env).catch((e) => console.error('view insert', e)));
        }
        if (assetRes.status !== 404) return assetRes;
      }
      // Statik dosya yoksa: kısa biçim /:code yalnız kod varsa ve aktifse
      const sm = p.match(/^\/([a-z0-9-]{1,40})\/?$/i);
      if (sm && request.method === 'GET') {
        const code = sm[1].toLowerCase();
        if (isValidCode(code)) {
          const inf = await getInfluencer(env.DB, code);
          if (inf && inf.active) return track.influencerHit(request, env, ctx, code);
        }
      }

      // 6) Gerçek 404 (assets'in kendi 404'ü)
      if (assetRes) return assetRes;
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Bulunamadı', { status: 404 });
    } catch (err) {
      console.error('worker error', p, err && err.stack ? err.stack : err);
      if (p.startsWith('/api/')) return json({ ok: false, error: 'server' }, 500);
      if (p.startsWith('/i/')) return Response.redirect(url.origin + '/', 302); // takip bozulsa da ziyaretçi siteye ulaşsın
      return new Response('Sunucu hatası', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
};
