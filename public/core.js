// Shared state and helpers for the CIVIQ map app.
import { $, esc, fmt, store, deviceId, api } from './common.js';
import { t, lang } from './i18n.js';
export { $, esc, fmt, store, deviceId, api, t };

export const S = { config: null, reports: [], wards: null, seats: null, map: null, userLoc: null, communities: [] };
const listeners = new Set();
export const onReports = fn => listeners.add(fn);
export function setReports(list) { S.reports = list; listeners.forEach(fn => fn()); }
export function mergeReport(u) {
  const i = S.reports.findIndex(x => x.id === u.id);
  if (i >= 0) S.reports[i] = u; else S.reports.unshift(u);
  listeners.forEach(fn => fn());
}

export const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
export const tel = n => `tel:${String(n).replace(/[^\d+]/g, '')}`;
export const waNumber = n => { const d = String(n).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : null; };
export const wa = (n, text) => { const d = waNumber(n); return d ? `https://wa.me/91${d}?text=${encodeURIComponent(text)}` : null; };
export const waShare = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const initials = name => String(name || '?').replace(/^(Dr|Sh|Shri|Smt)\.?\s+/i, '').split(/[\s,]+/).filter(w => /^[A-Za-z]/.test(w) && !/^(HCS|IAS)$/.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const DAY = 864e5;
export const daysSince = ts => Math.max(0, Math.floor((Date.now() - ts) / DAY));
export function ago(ts) {
  const d = daysSince(ts);
  if (d >= 2) return t('dAgo', { n: d });
  if (d === 1) return t('yesterday');
  const h = Math.floor((Date.now() - ts) / 3600_000);
  return h >= 1 ? t('hAgo', { n: h }) : t('justNow');
}
export const dateStr = ts => new Date(ts).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const sevLabel = k => t(`sev_${k}`);
export const wasteLabel = k => t(`waste_${k}`);
export const probLabel = k => t(`prob_${k}`);
export const SEV_COLOR = { minor: '#f2b705', moderate: '#f08c00', severe: '#e5383b', critical: '#7a1418' };
export const haversine = (a, b, c, d) => {
  const R = 6371000, r = x => x * Math.PI / 180, dLat = r(c - a), dLng = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export const fmtDist = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
export const isMobile = () => matchMedia('(max-width: 820px)').matches;
export const isTouch = () => matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
export const inAppBrowser = () => { const ua = navigator.userAgent; const m = ua.match(/Instagram|FBAN|FBAV|Line\/|WhatsApp|Snapchat|LinkedInApp|Twitter/); return m ? m[0].replace(/FBA[NV]/, 'Facebook').replace('/', '') : null; };

// ---------- toasts ----------
export function toast(msg, ok = true) {
  const el = document.createElement('div'); el.className = `toast${ok ? '' : ' bad'}`;
  el.innerHTML = `${icon(ok ? 'check' : 'alert')}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3800);
}

// ---------- modals (stackable) ----------
export function openModal(html, { sheet = false, cls = '', onClose, label = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `overlay${sheet ? ' sheet-modal' : ''}`;
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  const close = () => { wrap.remove(); onClose?.(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  $('#modalRoot').appendChild(wrap);
  setTimeout(() => wrap.querySelector('[autofocus], .modal button, .modal input')?.focus({ preventScroll: true }), 50);
  return { el: wrap.querySelector('.modal'), wrap, close };
}
export const closeTopModal = () => { const all = $('#modalRoot').children; if (all.length) all[all.length - 1].querySelector('[data-close]')?.click() ?? all[all.length - 1].remove(); };

// ---------- who is responsible ----------
export function peopleFor({ wardNo, zone, seat }) {
  const o = S.config.officials, wp = S.config.wardPeople;
  return { o, wp, z: wp.zones[zone], c: wp.councillors[wardNo], mla: seat && o.mlas[seat], seat };
}
export const wardSeat = wardNo => {
  const f = S.wards?.features.find(x => String(x.properties.ward_no) === String(wardNo));
  if (!f || !S.seats) return null;
  const b = new maplibregl.LngLatBounds(); f.geometry.coordinates.flat(2).forEach(c => b.extend(c));
  const c = b.getCenter(); return seatAtPoint(c.lng, c.lat);
};
function inRing(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
export function featureAt(fc, lng, lat) {
  for (const f of fc?.features || []) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some(p => inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h)))) return f;
  }
  return null;
}
export const seatAtPoint = (lng, lat) => featureAt(S.seats, lng, lat)?.properties.constituency || null;
export const wardAtPoint = (lng, lat) => featureAt(S.wards, lng, lat)?.properties.ward_no || null;
export const featureWard = n => S.wards?.features.find(f => String(f.properties.ward_no) === String(n));
export const wardsOfZone = z => (S.wards?.features || []).filter(f => f.properties.zone === z).map(f => String(f.properties.ward_no));
export function wardsOfSeat(seat) {
  return (S.wards?.features || []).filter(f => wardSeat(f.properties.ward_no) === seat).map(f => String(f.properties.ward_no));
}
export const zoneNo = z => ({ 'Zone I': '1', 'Zone II': '2', 'Zone III': '3', 'Zone IV': '4', 'Zone V': '5', 'Zone VI': '6' }[z]);
export const zoneFromNo = n => Object.keys(S.config.wardPeople.zones).find(z => zoneNo(z) === String(n));

// Contact card used on report pages, ward pages and the "who's responsible" step.
// Round portrait if we have a real photo, otherwise initials.
export const avatar = (photo, text, cls = '') => photo
  ? `<span class="av photo ${cls}"><img src="${esc(photo)}" alt="" loading="lazy"></span>`
  : `<span class="av ${cls}">${esc(text)}</span>`;
export function contactCard({ av, name, role, phone, email, primary = false, href, mailSubject = '', mailBody = '', waText = '', photo }) {
  const acts = [];
  if (phone) acts.push(`<a class="mini" href="${tel(phone)}" aria-label="Call ${esc(name)}">${icon('phone')}</a>`);
  if (phone && waNumber(phone)) acts.push(`<a class="mini" href="${esc(wa(phone, waText || mailBody))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(name)}">${icon('whatsapp')}</a>`);
  if (email) acts.push(`<a class="mini" href="mailto:${esc(email)}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}" aria-label="Email ${esc(name)}">${icon('mail')}</a>`);
  const inner = `${avatar(photo, av, primary ? 'pri' : '')}<span class="who-txt"><b>${esc(name)}</b><small>${esc(role)}</small></span>`;
  return `<div class="person ${primary ? 'primary' : ''}">${href ? `<a class="person-link" href="${esc(href)}" data-link>${inner}</a>` : `<span class="person-link">${inner}</span>`}<span class="acts">${acts.join('')}</span></div>`;
}

export function responsibleHtml({ wardNo, zone, seat, r, problem }) {
  const { o, wp, z, c, mla } = peopleFor({ wardNo, zone, seat });
  const link = r ? `${location.origin}/report/${r.id}` : `${location.origin}/ward/${wardNo}`;
  const subj = `Garbage complaint${wardNo ? ` · Ward ${wardNo}` : ''}${r ? `: ${r.landmark || r.locality}` : ''}`;
  const body = r ? `Garbage at ${r.landmark || r.locality}${wardNo ? `, Ward ${wardNo}` : ''}, Gurugram. Open ${daysSince(r.createdAt)} days, seen by ${r.seenCount + 1}. Photo and exact location: ${link}`
    : `Garbage reports in Ward ${wardNo}, Gurugram: ${link}`;
  let h = '';
  if (problem === 'fallen_tree') h += `<div class="box2 note-box"><b>${t('forestTitle')}</b><p>${t('forestBody')}</p></div>`;
  if (!wardNo) {
    h += `<div class="box2 note-box"><p>${t('outsideCard')}</p></div>`;
    h += `<div class="box2"><h4>${t('officers')}</h4>${o.helplines.map(x => contactCard({ av: '☎', name: x.label, role: x.number, phone: x.number })).join('')}
      ${mla ? contactCard({ photo: mla.photo, av: initials(mla.name), name: mla.name, role: `${t('mla')} · ${seat} · ${mla.party}`, href: `/mla/${encodeURIComponent(seat)}` }) : ''}</div>`;
    return h;
  }
  h += `<div class="box2 tree"><h4>${t('knowWard')}</h4>
    <a class="ward-line" href="/ward/${esc(wardNo)}" data-link><span class="ward-no">${esc(wardNo)}</span><span><b>${t('yourWard')} · ${t('kickerWard')} ${esc(wardNo)}</b><small>${esc(zone || '')}${seat ? ` · ${esc(seat)}` : ''}</small></span>${icon('next')}</a>
    <p class="tree-k">${t('officers')}</p>`;
  if (z) {
    h += contactCard({ av: 'SSI', name: z.ssi.name, role: `${t('ssi')} · ${zone} · ${t('startHere')}`, phone: z.ssi.phone, email: z.ssi.email, primary: true, mailSubject: subj, mailBody: body });
    h += contactCard({ av: 'JC', name: z.jc.name, role: `${t('jc')} · ${zone}`, phone: z.jc.phone, email: z.jc.email, href: `/zone/${zoneNo(zone)}`, mailSubject: subj, mailBody: body });
    h += contactCard({ av: 'EE', name: z.ee.name, role: `${t('ee')} · ${zone}`, phone: z.ee.phone, email: z.ee.email, mailSubject: subj, mailBody: body });
  }
  h += contactCard({ photo: wp.city.commissioner.photo, av: 'MC', name: wp.city.commissioner.name, role: t('commissioner'), phone: wp.city.commissioner.phone, email: wp.city.commissioner.email, mailSubject: subj, mailBody: body });
  h += `<p class="tree-k">${t('elected')}</p>`;
  if (c) h += contactCard({ av: initials(c.name), name: c.name, role: `${t('councillor')} · ${t('kickerWard')} ${wardNo}`, email: c.email, href: `/ward/${wardNo}`, mailSubject: subj, mailBody: body });
  h += contactCard({ photo: o.mayor.photo, av: initials(o.mayor.name), name: o.mayor.name, role: `${t('mayor')} · MCG · ${o.mayor.party}`, email: o.mayor.email, mailSubject: subj, mailBody: body });
  if (mla) h += contactCard({ photo: mla.photo, av: initials(mla.name), name: mla.name, role: `${t('mla')} · ${seat} · ${mla.party}`, href: `/mla/${encodeURIComponent(seat)}` });
  h += contactCard({ photo: o.mp.photo, av: initials(o.mp.name), name: o.mp.name, role: `${t('mp')} · ${o.mp.seat} · ${o.mp.party}`, href: '/mp/gurgaon' });
  h += `<p class="fine">${t('tapCard')}. SSI and EE offices are matched to zones by number (I–VI). Source: mcg.gov.in</p></div>`;
  return h;
}

// Stamp a strip with time, ward and coordinates under a verification photo.
export function stampPhoto(dataUrl, { wardNo, lat, lng }) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const strip = Math.round(img.width * 0.07);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height + strip;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      g.fillStyle = '#0e3b2e'; g.fillRect(0, img.height, c.width, strip);
      g.fillStyle = '#fff'; g.font = `600 ${Math.round(strip * 0.42)}px Inter, sans-serif`; g.textBaseline = 'middle';
      const when = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      g.fillText(`CIVIQ · ${when} · ${wardNo ? `Ward ${wardNo}` : 'Gurugram'} · ${lat.toFixed(5)}, ${lng.toFixed(5)}`, strip * 0.4, img.height + strip / 2);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}
