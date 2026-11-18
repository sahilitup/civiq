export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => Number(n || 0).toLocaleString('en-IN');
export const DAY = 86400_000;
export const daysSince = t => Math.max(0, Math.floor((Date.now() - t) / DAY));
export const ago = t => { const d = daysSince(t); if (d >= 1) return `${d}d ago`; const h = Math.floor((Date.now() - t) / 3600_000); return h >= 1 ? `${h}h ago` : 'just now'; };
export const initials = name => String(name || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export { store };

let memDevice;
export function deviceId() {
  let d = store.get('ak_device');
  if (!d) { d = memDevice || crypto.randomUUID(); memDevice = d; store.set('ak_device', d); }
  return d;
}

export async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

// Downscale a camera photo to a JPEG data URL (keeps uploads small on mobile data).
export function compressImage(file, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo')); };
    img.src = url;
  });
}

export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share location'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(e.code === 1 ? 'Location permission was denied. Allow location for this site in your browser settings, then try again.' : 'Could not get your location. Move to open sky and try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
