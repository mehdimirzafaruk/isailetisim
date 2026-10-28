// Bio sayfası ziyaret kaynağı: ?s= etiketi > ?ref= (influencer) > Referer > uygulama içi tarayıcı > direkt.
import { isValidCode, slugify, CHANNELS } from './util.js';

export { CHANNELS };

export const TRAFFIC_LABELS = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', youtube: 'YouTube', linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp', telegram: 'Telegram', google: 'Google', direkt: 'Direkt', influencer: 'Influencer linkleri',
  web: 'Diğer web', '?': 'Eşleşmeyen tıklama',
};

/** Kaynak anahtarı -> Türkçe etiket (web:alan.com -> alan.com, s:kampanya -> "Etiket: kampanya") */
export function trafficLabel(k) {
  k = k || 'direkt';
  if (TRAFFIC_LABELS[k]) return TRAFFIC_LABELS[k];
  if (k.startsWith('web:')) return k.slice(4);
  if (k.startsWith('s:')) return `Etiket: ${k.slice(2)}`;
  return k;
}

// Referer alan adı kuralları (www. önceden atılır). Sıra önemli değil, alan adları çakışmıyor.
const HOST_RULES = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'google'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, 'telegram'],
];
// Android uygulama referer'ı: android-app://com.instagram.android/
const ANDROID_APPS = {
  'com.instagram.android': 'instagram', 'com.zhiliaoapp.musically': 'tiktok', 'com.ss.android.ugc.trill': 'tiktok',
  'com.facebook.katana': 'facebook', 'com.facebook.lite': 'facebook', 'com.twitter.android': 'x',
  'com.google.android.youtube': 'youtube', 'com.linkedin.android': 'linkedin', 'com.whatsapp': 'whatsapp',
  'com.whatsapp.w4b': 'whatsapp', 'org.telegram.messenger': 'telegram', 'com.google.android.googlequicksearchbox': 'google',
};
const BROWSER_SOURCES = { 'Instagram in-app': 'instagram', 'TikTok in-app': 'tiktok', 'Facebook in-app': 'facebook', 'X in-app': 'x' };

/** ?s= değeri -> kaynak; bilinmeyen etiket "s:<slug>" (a-z0-9-, en çok 20). Boşsa null. */
export function sourceFromTag(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v) return null;
  if (CHANNELS[v]) return CHANNELS[v];
  const slug = slugify(v).slice(0, 20).replace(/-+$/, ''); // Türkçe harfler sadeleşir: 'Kasım Çekiliş' -> 'kasim-cekilis'
  return slug ? `s:${slug}` : null;
}

/** Ham Referer -> kaynak; kendi alan adımızdan geliyorsa (sayfa içi gezinme) veya yoksa null. */
export function sourceFromReferer(referer, selfHost = '') {
  if (!referer) return null;
  let u;
  try { u = new URL(referer); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  if (u.protocol === 'android-app:') return ANDROID_APPS[host] || `web:${host}`.slice(0, 40);
  const self = String(selfHost || '').toLowerCase().replace(/^www\./, '');
  if (self && host === self) return null;
  for (const [re, src] of HOST_RULES) if (re.test(host)) return src;
  return `web:${host}`.slice(0, 40);
}

/**
 * Tüm kuralları sırayla uygular. Dönen: { source, code }.
 * code yalnız biçimce geçerli ?ref= varsa dolar; influencer'ın var olup olmadığını çağıran denetler
 * (yoksa `ignoreRef: true` ile tekrar çağırır).
 */
export function detectSource({ url, referer, browser, ignoreRef = false }) {
  const u = url instanceof URL ? url : new URL(url);
  const tagged = sourceFromTag(u.searchParams.get('s'));
  if (tagged) return { source: tagged, code: null };
  if (!ignoreRef) {
    const ref = String(u.searchParams.get('ref') || '').trim().toLowerCase();
    if (ref && isValidCode(ref)) return { source: 'influencer', code: ref };
  }
  const fromRef = sourceFromReferer(referer, u.hostname);
  if (fromRef) return { source: fromRef, code: null };
  if (BROWSER_SOURCES[browser]) return { source: BROWSER_SOURCES[browser], code: null };
  return { source: 'direkt', code: null };
}
