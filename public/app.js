import { $, esc, fmt, store, api, t, S, onReports, setReports, mergeReport, icon, tel, toast, openModal, closeTopModal, DAY, daysSince, ago, dateStr,
  sevLabel, wasteLabel, probLabel, SEV_COLOR, isMobile, isTouch, featureAt, featureWard, wardAtPoint, seatAtPoint, wardsOfZone, wardsOfSeat, wardSeat, zoneNo, zoneFromNo,
  responsibleHtml, contactCard, initials, waShare } from './core.js';
import { applyI18n, setLang, lang } from './i18n.js';
import { startReport, spotFlow, shareSheet, lightbox, qrSheet } from './flow.js';

const CENTER = [77.045, 28.445];
const state = { status: '', severity: '', waste: '', problem: '', sort: 'nearest', limit: 24, route: '/', prevRoutes: [] };
const sheet = $('#sheet'), view = $('#view');
let markers = [];

// ================= boot =================
async function boot() {
  S.config = await api('/api/config');
  applyI18n();
  bindSearch(); renderFilters();
  initMap();
  const [reports, communities, wards, seats] = await Promise.all([api('/api/reports'), api('/api/communities').catch(() => []), api('/api/wards'), api('/api/assembly')]);
  S.communities = communities; S.wards ||= wards; S.seats ||= seats;
  setReports(reports);
  route(location.pathname, { replace: true });
  if (!store.get('civiq_intro')) intro();
}
onReports(() => {
  updateMapData();
  if (state.route === '/') renderHomeLists();
  const m = state.route.match(/^\/report\/([a-f0-9-]{36})/);
  const r = m && S.reports.find(x => x.id === m[1]);
  if (r) { const top = view.scrollTop; renderReport(r); view.scrollTop = top; }
});

// ================= router =================
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]'); if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault(); closeAllModals(); go(a.getAttribute('href'));
});
window.addEventListener('civiq:open', e => go(e.detail));
addEventListener('popstate', () => route(location.pathname, { replace: true, pop: true }));
function closeAllModals() { $('#modalRoot').innerHTML = ''; }
export function go(path) { if (path === location.pathname) return route(path, { replace: true }); state.prevRoutes.push(location.pathname); history.pushState({}, '', path); route(path); }
function back() { if (state.prevRoutes.length) { state.prevRoutes.pop(); history.back(); } else go('/'); }

function route(path, { pop } = {}) {
  state.route = path; let m;
  clearMarkers(); select(null, []);
  if (path === '/' || path === '') return home();
  if ((m = path.match(/^\/report\/([a-f0-9-]{36})/))) return reportView(m[1]);
  if ((m = path.match(/^\/ward\/(\d+)/))) return areaView('ward', m[1]);
  if ((m = path.match(/^\/mla\/([^/]+)/))) return areaView('mla', decodeURIComponent(m[1]));
  if (path.startsWith('/mp/')) return areaView('mp', 'gurgaon');
  if ((m = path.match(/^\/zone\/(\d)/))) return areaView('zone', m[1]);
  if (path === '/wards' || path === '/leaderboard') return leaderboardView();
  if (path === '/communities') return communitiesView();
  if (path === '/communities/register') return registerView();
  notFound('page');
  void pop;
}
function show(html, { snap = 'full', title } = {}) {
  view.innerHTML = html; view.scrollTop = 0;
  sheet.classList.toggle('detail', state.route !== '/');
  if (isMobile()) setSnap(snap);
  if (title) document.title = title;
  view.querySelector('[data-back]')?.addEventListener('click', back);
}
const head = (title, extra = '') => `<div class="d-head"><button class="x" data-back aria-label="${t('back')}">${icon('back')}</button><span class="t">${title}</span>${extra}</div>`;

// ================= map =================
function initMap() {
  const map = S.map = new maplibregl.Map({ container: 'map', style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: CENTER, zoom: isMobile() ? 10.6 : 11.3, minZoom: 9.5, maxBounds: [[76.7, 28.2], [77.35, 28.7]], attributionControl: { compact: true } });
  const fit = () => map.resize();
  addEventListener('resize', fit); new ResizeObserver(fit).observe($('#map'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fit(); });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, showUserLocation: true, fitBoundsOptions: { maxZoom: 14 } });
  map.addControl(geo, 'bottom-right');
  geo.on('geolocate', p => {
    const { latitude: lat, longitude: lng } = p.coords; S.userLoc = { lat, lng };
    const b = S.config.bbox; hideMapToast();
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) toast(t('outsideCity'), false);
    updateCommunityDot();
  });
  geo.on('error', hideMapToast);
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

  map.on('load', async () => {
    fit();
    if (!S.wards) [S.wards, S.seats] = await Promise.all([api('/api/wards'), api('/api/assembly')]);
    map.addSource('wards', { type: 'geojson', data: S.wards, promoteId: 'ward_no' });
    map.addLayer({ id: 'ward-fill', type: 'fill', source: 'wards', paint: {
      'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'open'], 0], 0, '#0e3b2e', 1, '#f6b9b9', 10, '#ef6f71', 30, '#c4161c'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.34, ['boolean', ['feature-state', 'hover'], false], 0.22, ['>', ['coalesce', ['get', 'open'], 0], 0], 0.26, 0.03] } });
    map.addLayer({ id: 'ward-line', type: 'line', source: 'wards', paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#0e3b2e', '#2c5a4a'],
      'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.6, 0.7], 'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.95, 0.28] } });
    map.addLayer({ id: 'ward-label', type: 'symbol', source: 'wards', minzoom: 11.8,
      layout: { 'text-field': ['get', 'ward_no'], 'text-size': 12, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] },
      paint: { 'text-color': '#2c5a4a', 'text-halo-color': '#fff', 'text-halo-width': 1.6, 'text-opacity': 0.75 } });
    let hovered = null;
    map.on('mousemove', 'ward-fill', e => {
      const f = e.features[0];
      if (hovered !== f.id) { if (hovered != null) map.setFeatureState({ source: 'wards', id: hovered }, { hover: false }); hovered = f.id; map.setFeatureState({ source: 'wards', id: hovered }, { hover: true }); }
      const c = S.config.wardPeople.councillors[f.properties.ward_no];
      popup.setLngLat(e.lngLat).setHTML(`<div class="ward-tip"><b>${t('kickerWard')} ${esc(f.properties.ward_no)}</b>${c ? esc(c.name) + ' · ' : ''}<span>${f.properties.open || 0} ${t('open').toLowerCase()}</span></div>`).addTo(map);
    });
    map.on('mouseleave', 'ward-fill', () => { if (hovered != null) map.setFeatureState({ source: 'wards', id: hovered }, { hover: false }); hovered = null; popup.remove(); });
    map.on('click', e => {
      if (map.queryRenderedFeatures(e.point, { layers: ['clusters', 'points'] }).length) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ['ward-fill'] })[0];
      if (f) go(`/ward/${f.properties.ward_no}`);
    });
    map.addSource('reports', { type: 'geojson', data: toGeo(), cluster: true, clusterRadius: 44, clusterMaxZoom: 15,
      clusterProperties: { open: ['+', ['case', ['==', ['get', 'status'], 'open'], 1, 0]] } });
    map.addLayer({ id: 'clusters', type: 'circle', source: 'reports', filter: ['has', 'point_count'], paint: {
      'circle-color': ['case', ['==', ['get', 'open'], 0], '#1f9d55', ['<', ['get', 'point_count'], 10], '#e5383b', '#9d1c1f'],
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 50, 26, 200, 32],
      'circle-stroke-width': 4, 'circle-stroke-color': ['case', ['==', ['get', 'open'], 0], 'rgba(31,157,85,.25)', 'rgba(229,56,59,.25)'] } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'reports', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'points-halo', type: 'circle', source: 'reports', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 18, 'circle-color': '#0e3b2e', 'circle-opacity': 0.18 } });
    map.addLayer({ id: 'points', type: 'circle', source: 'reports', filter: ['!', ['has', 'point_count']], paint: {
      'circle-color': ['case', ['==', ['get', 'status'], 'resolved'], '#1f9d55', ['match', ['get', 'severity'], 'critical', SEV_COLOR.critical, 'severe', SEV_COLOR.severe, 'moderate', SEV_COLOR.moderate, SEV_COLOR.minor]],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9],
      'circle-stroke-width': ['case', ['get', 'review'], 4, 2.5], 'circle-stroke-color': ['case', ['get', 'review'], '#f2b705', '#fff'] } });
    map.on('click', 'clusters', async e => { const f = e.features[0]; const z = await map.getSource('reports').getClusterExpansionZoom(f.properties.cluster_id); map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 }); });
    map.on('click', 'points', e => go(`/report/${e.features[0].properties.id}`));
    for (const l of ['clusters', 'points', 'ward-fill']) { map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', l, () => map.getCanvas().style.cursor = ''); }
    map.on('moveend', () => { if (state.route === '/' && state.sort === 'nearest') renderHomeLists(); });
    updateMapData(); route(location.pathname, { replace: true });
    // Find the user on open, like a maps app.
    if (navigator.geolocation && state.route === '/') { showMapToast(t('locatingYou')); setTimeout(() => geo.trigger(), 300); setTimeout(hideMapToast, 9000); }
  });
}
const showMapToast = msg => { const el = $('#mapToast'); el.innerHTML = `<span class="spin"></span>${esc(msg)}`; el.classList.remove('hidden'); };
const hideMapToast = () => $('#mapToast').classList.add('hidden');
const filtered = () => S.reports.filter(r => (!state.status || r.status === state.status) && (!state.severity || r.severity === state.severity)
  && (!state.waste || r.wasteType === state.waste) && (!state.problem || r.complaintType === state.problem));
const toGeo = () => ({ type: 'FeatureCollection', features: filtered().map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
  properties: { id: r.id, status: r.status, severity: r.severity, review: !!r.resolutionPending } })) });
function updateMapData() {
  const map = S.map; if (!map?.getSource('reports')) return;
  map.getSource('reports').setData(toGeo());
  if (S.wards) {
    const openBy = {}; for (const r of S.reports) if (r.status === 'open' && r.wardNo) openBy[r.wardNo] = (openBy[r.wardNo] || 0) + 1;
    for (const f of S.wards.features) f.properties.open = openBy[String(f.properties.ward_no)] || 0;
    map.getSource('wards').setData(S.wards);
  }
}
let selWards = [];
function select(r, wards = []) {
  const map = S.map; if (!map?.getLayer('points-halo')) return;
  map.setFilter('points-halo', ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], r ? r.id : '']]);
  selWards.forEach(id => map.setFeatureState({ source: 'wards', id }, { sel: false }));
  selWards = wards.map(String); selWards.forEach(id => map.setFeatureState({ source: 'wards', id }, { sel: true }));
}
const padding = () => isMobile() ? { top: 70, bottom: Math.round(innerHeight * 0.55), left: 30, right: 30 } : { top: 50, bottom: 50, left: 50, right: 50 };
function fitWards(wards) {
  const b = new maplibregl.LngLatBounds();
  wards.forEach(w => featureWard(w)?.geometry.coordinates.flat(2).forEach(c => b.extend(c)));
  if (!b.isEmpty()) S.map.fitBounds(b, { padding: padding(), maxZoom: 14.5, duration: 700 });
}
function clearMarkers() { markers.forEach(m => m.remove()); markers = []; }
function numberMarker(lngLat, n, href, label) {
  const el = document.createElement('a'); el.className = 'num-marker'; el.href = href; el.dataset.link = ''; el.textContent = n; el.title = label;
  markers.push(new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(S.map));
}
const wardCenter = w => { const f = featureWard(w); if (!f) return null; const b = new maplibregl.LngLatBounds(); f.geometry.coordinates.flat(2).forEach(c => b.extend(c)); return b.getCenter(); };

// ================= mobile sheet =================
function setSnap(s) { sheet.dataset.snap = s; }
(function sheetDrag() {
  const g = $('#grabber'), order = ['peek', 'half', 'full']; let y0 = null, t0 = 0, base = 0;
  g.addEventListener('click', () => { if (isMobile()) setSnap(order[(order.indexOf(sheet.dataset.snap) + 1) % 3]); });
  g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.click(); } });
  g.addEventListener('pointerdown', e => { if (!isMobile()) return; y0 = e.clientY; t0 = Date.now(); base = sheet.getBoundingClientRect().top; sheet.classList.add('dragging'); g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if (y0 == null) return; const top = Math.max(64, base + e.clientY - y0); sheet.style.transform = `translateY(${top - (innerHeight - sheet.offsetHeight)}px)`; });
  g.addEventListener('pointerup', e => {
    if (y0 == null) return; sheet.classList.remove('dragging'); sheet.style.transform = '';
    const dy = e.clientY - y0, fast = Math.abs(dy) / (Date.now() - t0) > 0.5;
    if (Math.abs(dy) > 10) { const i = order.indexOf(sheet.dataset.snap); setSnap(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1) * (fast ? 2 : 1)))]); g.addEventListener('click', ev => ev.stopImmediatePropagation(), { once: true, capture: true }); }
    y0 = null;
  });
})();

// ================= top bar =================
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'whatsnew') whatsNew();
  if (act === 'lang') switchLang();
  if (act === 'follow') followSheet();
  if (act === 'about') aboutSheet();
  if (act === 'video') videoSheet();
  if (act === 'officials') officialsSheet();
  if (act === 'digest') digestSheet();
  if (act === 'filters') filtersSheet();
  if (act === 'report') startReport();
  if (act === 'qr') qrSheet();
  if (act === 'menu') menuSheet();
});
$('#reportFab').onclick = () => startReport();
$('#tbReport').onclick = () => startReport();
function switchLang() { setLang(lang === 'hi' ? 'en' : 'hi'); applyI18n(); renderFilters(); route(location.pathname, { replace: true }); }
const topbar = $('#topbar');
$('#searchOpen').onclick = () => { topbar.classList.add('searching'); setTimeout(() => $('#search').focus(), 50); };
$('#searchClose').onclick = () => { topbar.classList.remove('searching'); $('#search').value = ''; $('#searchResults').classList.add('hidden'); };

// Severity / status / more filters. Rendered in the top bar (desktop) and in the panel (phones).
function filtersHtml() {
  const n = (state.waste ? 1 : 0) + (state.problem ? 1 : 0);
  return `<select data-f="severity" aria-label="${t('severity')}"><option value="">${t('allSeverity')}</option>${S.config.severities.map(s => `<option value="${s}" ${state.severity === s ? 'selected' : ''}>${sevLabel(s)}</option>`).join('')}</select>
    <select data-f="status" aria-label="${t('status')}"><option value="">${t('allStatus')}</option><option value="open" ${state.status === 'open' ? 'selected' : ''}>${t('unresolved')}</option><option value="resolved" ${state.status === 'resolved' ? 'selected' : ''}>${t('resolved')}</option></select>
    <button class="fbtn" data-act="filters">${icon('sliders')}<span>${t('filters')}</span>${n ? `<i class="count">${n}</i>` : ''}</button>`;
}
function renderFilters() { $('#tbFilters').innerHTML = filtersHtml(); const m = $('#mFilters'); if (m) m.innerHTML = filtersHtml(); }
document.addEventListener('change', e => {
  const sel = e.target.closest('select[data-f]'); if (!sel) return;
  state[sel.dataset.f] = sel.value; state.limit = 24; updateMapData(); renderFilters(); renderHomeLists();
});
function menuSheet() {
  const f = S.config.officials.follow || {}, hasFollow = Object.values(f).some(Boolean);
  const row = (href, ic, label, sub = '', act = '') => act ? `<button class="follow-row" data-act="${act}" data-close>${icon(ic)}<span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`
    : `<a class="follow-row" href="${href}" ${/^\/(communities|wards)/.test(href) ? 'data-link' : ''}>${icon(ic)}<span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></a>`;
  openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><img src="/logo.svg" alt="CIVIQ" class="logo" style="margin-bottom:10px">
    ${row('/communities', 'users', t('communities'), t('commSubFallback'))}${row('/wards', 'trophy', t('leaderboard'), t('lbSub'))}${row('/analytics', 'chart', t('analytics'))}
    ${row('', 'building', t('cityOfficials'), '', 'officials')}${row('', 'sparkle', t('whatsNew'), `v${esc(S.config.version)}`, 'whatsnew')}${row('', 'bell', t('digestTitle'), t('digestSuffix'), 'digest')}
    ${hasFollow ? row('', 'at', t('follow'), '', 'follow') : ''}${row('', 'info', t('about'), '', 'about')}${row('/downloads', 'download', t('downloads'))}</div>`, { sheet: true, label: t('menu') });
}

// ================= home =================
function home() {
  const sub = S.config.subscribers, examples = S.reports.filter(r => r.isExample).length;
  show(`${store.get('civiq_digest_x') ? '' : `<div class="digest-banner"><button data-act="digest">${icon('bell')}<span>${sub >= 10 ? `<b>${t('digestJoin', { n: fmt(sub) })}</b> ${t('digestJoinSuffix')}` : `<b>${t('digestSubscribe')}</b> ${t('digestSuffix')}`}</span></button><button class="x sm" id="digestX" aria-label="${t('close')}">${icon('x')}</button></div>`}
    <div class="stat-row">
      <div class="stat"><b id="sOpen">–</b><span>${t('active')}</span></div>
      <div class="stat plain"><b id="sTotal">–</b><span>${t('reports')}</span></div>
      <button class="stat officials" data-act="officials">${icon('building')}<span>${t('cityOfficials')}</span></button>
    </div>
    <button class="watch-card" data-act="video"><span class="wc-thumb" style="background-image:url('/video/civiq-explainer.jpg')"><span class="wc-play">${icon('play')}</span></span><span class="wc-txt"><b>${t('watchTitle')}</b><small>${t('watchSub')}</small></span></button>
    ${examples ? `<p class="example-note">${icon('info')}<span>${t('examplesBanner', { n: examples })}</span></p>` : ''}
    <div class="filterbar m-only" id="mFilters"></div>
    <section class="discover"><div class="disc-head"><h3 id="discTitle"></h3><p class="fine" id="discSub"></p></div>
      <div class="tabs" id="sortTabs">${['nearest', 'oldest', 'seen'].map(s => `<button class="tab ${state.sort === s ? 'on' : ''}" data-s="${s}">${t(s === 'nearest' ? 'sortNearest' : s === 'oldest' ? 'sortOldest' : 'sortSeen')}</button>`).join('')}</div>
      <div class="pgrid" id="cards"></div><button class="more hidden" id="moreBtn"></button></section>
    ${footerHtml()}`, { snap: sheet.dataset.snap === 'full' ? 'half' : sheet.dataset.snap, title: 'CIVIQ · Report garbage in Gurugram' });
  sheet.classList.remove('detail');
  renderFilters();
  $('#digestX')?.addEventListener('click', () => { store.set('civiq_digest_x', '1'); home(); });
  $('#sortTabs').onclick = e => { const b = e.target.closest('.tab'); if (!b) return; state.sort = b.dataset.s; state.limit = 24; $('#sortTabs').querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b)); renderHomeLists(); };
  $('#moreBtn').onclick = () => { state.limit += 24; renderHomeLists(); };
  $('#cards').onclick = e => { const c = e.target.closest('[data-id]'); if (c) go(`/report/${c.dataset.id}`); if (e.target.closest('[data-act="report"]')) startReport(); };
  renderHomeLists(); updateCommunityDot();
}
function footerHtml() {
  return `<footer class="side-foot"><span>${icon('shield')} ${t('anonymous')}</span>
    <nav><a href="/about">${t('about')}</a><a href="/methodology">${t('methodology')}</a><a href="/downloads">${t('downloads')}</a><a href="/status">${t('statusPage')}</a><a href="/privacy">${t('privacy')}</a><a href="/terms">${t('terms')}</a><a href="/contact">${t('contact')}</a></nav></footer>`;
}
function renderHomeLists() {
  if (!$('#cards')) return;
  const all = filtered(), open = S.reports.filter(r => r.status === 'open');
  $('#sOpen').textContent = fmt(open.length); $('#sTotal').textContent = fmt(S.reports.length);
  const map = S.map, zoomed = map && map.getZoom() >= 12.5;
  let list = state.status ? all : all.filter(r => r.status === 'open');
  if (zoomed && state.sort === 'nearest') { const b = map.getBounds(); list = list.filter(r => b.contains([r.lng, r.lat])); }
  const c = map ? map.getCenter() : { lng: CENTER[0], lat: CENTER[1] };
  const dist = r => (r.lat - c.lat) ** 2 + ((r.lng - c.lng) * Math.cos(c.lat * Math.PI / 180)) ** 2;
  list.sort(state.sort === 'oldest' ? (a, b) => a.createdAt - b.createdAt : state.sort === 'seen' ? (a, b) => b.seenCount - a.seenCount : (a, b) => dist(a) - dist(b));
  $('#discTitle').innerHTML = `<b>${fmt(list.length)}</b> ${zoomed && state.sort === 'nearest' ? t('openInArea') : t('openInCity')}`;
  $('#discSub').textContent = state.sort === 'nearest' ? t('discoverSub') : '';
  $('#cards').innerHTML = list.length ? list.slice(0, state.limit).map(photoCard).join('')
    : `<div class="empty wide"><img src="/favicon.svg" alt="" class="empty-ic"><h3>${S.reports.length ? t('noneMatch') : t('noReportsYet').split('.')[0]}</h3><p>${S.reports.length ? t('discoverEmpty') : t('noReportsYet').split(/[.।]\s*/).slice(1).join(' ')}</p>
      <button class="btn btn-red" data-act="${isTouch() ? 'report' : 'qr'}">${icon('camera')}${t('reportGarbage')}</button></div>`;
  $('#moreBtn').classList.toggle('hidden', list.length <= state.limit);
  $('#moreBtn').textContent = t('showMore', { n: Math.min(24, list.length - state.limit) });
}
const photoCard = r => {
  const d = daysSince(r.createdAt), open = r.status === 'open';
  return `<button class="pcard" data-id="${r.id}"><span class="ph" style="background-image:url('${esc(r.photo)}')">
      ${open ? `<span class="badge ${d >= 7 ? 'red' : ''}">${d ? `${d}d` : t('today')}</span>` : `<span class="badge ok">${icon('check')}</span>`}
      ${r.resolutionPending ? `<span class="badge amber tr">${t('underReview')}</span>` : r.isExample ? `<span class="badge ex tr">${t('example')}</span>` : ''}
      ${r.seenCount ? `<span class="seen">${icon('eye')}${t('othersSaw', { n: r.seenCount })}</span>` : ''}</span>
    <span class="pc-body"><b>${esc(r.wardNo ? `${t('kickerWard')} ${r.wardNo}` : r.locality)}</b><small>${esc(r.landmark || r.locality)}</small></span></button>`;
};

// ================= search =================
function bindSearch() {
  const input = $('#search'), box = $('#searchResults'); let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer); const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      const wp = S.config.wardPeople, o = S.config.officials, res = [];
      for (const f of S.wards?.features || []) {
        const n = String(f.properties.ward_no), c = wp.councillors[n]?.name || '';
        if (q.replace(/\s+/g, '') === `ward${n}` || q === n || (q.length > 2 && (c.toLowerCase().includes(q) || f.properties.localities.toLowerCase().includes(q))))
          res.push({ g: 'wardsHead', ic: 'grid', t: `${t('kickerWard')} ${n} · ${c}`, s: `${f.properties.zone} · ${f.properties.localities.split(',').slice(0, 3).join(',')}`, href: `/ward/${n}` });
      }
      if (q.length > 2) {
        for (const [seat, m] of Object.entries(o.mlas)) if (`${m.name} ${seat}`.toLowerCase().includes(q)) res.push({ g: 'officialsHead', ic: 'users', t: m.name, s: `${t('mla')} · ${seat}`, href: `/mla/${encodeURIComponent(seat)}` });
        if (`${o.mp.name} mp`.toLowerCase().includes(q)) res.push({ g: 'officialsHead', ic: 'users', t: o.mp.name, s: `${t('mp')} · ${o.mp.seat}`, href: '/mp/gurgaon' });
        for (const [z, p] of Object.entries(wp.zones)) for (const [k, role] of [['jc', 'jc'], ['ssi', 'ssi'], ['ee', 'ee']])
          if (p[k].name.toLowerCase().includes(q)) res.push({ g: 'officialsHead', ic: 'building', t: p[k].name, s: `${t(role)} · ${z}`, href: `/zone/${zoneNo(z)}` });
        if (wp.city.commissioner.name.toLowerCase().includes(q) || 'commissioner'.includes(q)) res.push({ g: 'officialsHead', ic: 'building', t: wp.city.commissioner.name, s: t('commissioner'), act: 'officials' });
        for (const r of S.reports) if (`${r.landmark} ${r.locality}`.toLowerCase().includes(q) && res.filter(x => x.g === 'reportsHead').length < 4)
          res.push({ g: 'reportsHead', ic: 'camera', t: r.landmark || r.locality, s: `${r.locality}${r.wardNo ? ` · ${t('kickerWard')} ${r.wardNo}` : ''}`, href: `/report/${r.id}` });
        try {
          const b = S.config.bbox;
          const places = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&bounded=1&viewbox=${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}&q=${encodeURIComponent(q)}`)).json();
          for (const p of places) res.push({ g: 'places', ic: 'pin', t: p.display_name.split(',')[0], s: p.display_name.split(',').slice(1, 3).join(','), lng: +p.lon, lat: +p.lat });
        } catch { /* offline */ }
      }
      const groups = ['wardsHead', 'officialsHead', 'places', 'reportsHead'];
      box.innerHTML = res.length ? groups.map(g => { const items = res.filter(x => x.g === g); return items.length ? `<div class="k">${t(g)}</div>${items.slice(0, 5).map(x => `<button data-i="${res.indexOf(x)}">${icon(x.ic)}<span>${esc(x.t)}<small>${esc(x.s)}</small></span></button>`).join('')}` : ''; }).join('')
        : `<div class="k">${t('noResults')}</div>`;
      box.classList.remove('hidden');
      box.onclick = ev => {
        const x = res[ev.target.closest('button')?.dataset.i]; if (!x) return;
        box.classList.add('hidden'); input.value = ''; topbar.classList.remove('searching');
        if (x.href) go(x.href); else if (x.act === 'officials') officialsSheet(); else { S.map.flyTo({ center: [x.lng, x.lat], zoom: 15, padding: padding() }); if (isMobile()) setSnap('peek'); }
      };
    }, 220);
  });
}
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); topbar.classList.add('searching'); $('#search').focus(); }
  if (e.key === 'Escape') { if ($('#modalRoot').children.length) closeTopModal(); else $('#searchResults')?.classList.add('hidden'); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#searchResults')?.classList.add('hidden'); });

// ================= sheets =================
function filtersSheet() {
  const draft = { waste: state.waste, problem: state.problem, severity: state.severity, status: state.status };
  const chips = (key, list, label) => `<div class="chips" data-k="${key}"><button data-v="" class="${!draft[key] ? 'on' : ''}">${t('all')}</button>${list.map(v => `<button data-v="${v}" class="${draft[key] === v ? 'on' : ''}">${esc(label(v))}</button>`).join('')}</div>`;
  const count = () => S.reports.filter(r => (!draft.status || r.status === draft.status) && (!draft.severity || r.severity === draft.severity) && (!draft.waste || r.wasteType === draft.waste) && (!draft.problem || r.complaintType === draft.problem)).length;
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('filters')}</h2>
    <h4>${t('severity')}</h4>${chips('severity', S.config.severities, sevLabel)}
    <h4>${t('status')}</h4>${chips('status', ['open', 'resolved'], v => t(v === 'open' ? 'unresolved' : 'resolved'))}
    <h4>${t('wasteType')}</h4>${chips('waste', S.config.wasteTypes, wasteLabel)}
    <h4>${t('problem')}</h4>${chips('problem', S.config.problems, probLabel)}</div>
    <footer class="flow-foot row-btns"><button class="btn btn-ghost" data-reset>${t('reset')}</button><button class="btn btn-primary" data-apply></button></footer>`, { sheet: true, label: t('filters') });
  const sync = () => { m.el.querySelector('[data-apply]').textContent = count() ? t('showN', { n: fmt(count()) }) : t('noneMatch'); };
  m.el.addEventListener('click', e => {
    const b = e.target.closest('.chips button'); if (b) { const k = b.parentElement.dataset.k; draft[k] = b.dataset.v; b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); sync(); }
    if (e.target.closest('[data-reset]')) { Object.keys(draft).forEach(k => draft[k] = ''); m.el.querySelectorAll('.chips').forEach(c => c.querySelectorAll('button').forEach((x, i) => x.classList.toggle('on', i === 0))); sync(); }
    if (e.target.closest('[data-apply]')) { Object.assign(state, draft, { limit: 24 }); m.close(); updateMapData(); if (state.route === '/') home(); }
  });
  sync();
}
function officialsSheet() {
  const wp = S.config.wardPeople, o = S.config.officials, open = S.reports.filter(r => r.status === 'open');
  const zoneCards = Object.entries(wp.zones).map(([z, p]) => `<a class="off-card" href="/zone/${zoneNo(z)}" data-link><span class="av">${initials(p.jc.name)}</span><span><b>${esc(z)}</b><small>${esc(p.jc.name)}</small></span><span class="n">${open.filter(r => r.zone === z).length}</span></a>`).join('');
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('cityOfficials')}</h2>
    <p class="muted">Municipal Corporation of Gurugram</p>
    ${contactCard({ photo: wp.city.commissioner.photo, av: 'MC', name: wp.city.commissioner.name, role: t('commissioner'), phone: wp.city.commissioner.phone, email: wp.city.commissioner.email, primary: true })}
    ${contactCard({ av: 'SBM', name: wp.city.jc_sbm.name, role: wp.city.jc_sbm.role, phone: wp.city.jc_sbm.phone, email: wp.city.jc_sbm.email })}
    <h4>${t('jc')} · 6 ${t('kickerZone').toLowerCase()}s</h4><div class="off-grid">${zoneCards}</div>
    <h4>${t('elected')}</h4>
    ${contactCard({ photo: o.mayor.photo, av: initials(o.mayor.name), name: o.mayor.name, role: `${t('mayor')} · ${o.mayor.party}`, email: o.mayor.email })}
    ${Object.entries(o.mlas).map(([seat, x]) => contactCard({ photo: x.photo, av: initials(x.name), name: x.name, role: `${t('mla')} · ${seat} · ${x.party}`, href: `/mla/${encodeURIComponent(seat)}` })).join('')}
    ${contactCard({ photo: o.mp.photo, av: initials(o.mp.name), name: o.mp.name, role: `${t('mp')} · ${o.mp.seat} · ${o.mp.party}`, href: '/mp/gurgaon' })}
    ${o.helplines.map(x => contactCard({ av: '☎', name: x.label, role: x.number, phone: x.number })).join('')}</div>`, { sheet: true, label: t('cityOfficials') });
  void m;
}
async function whatsNew() {
  const log = await api('/api/changelog').catch(() => []);
  openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('changelog')}</h2>
    ${log.map((v, i) => `<div class="cl"><div class="cl-h"><b>v${esc(v.version)}</b>${i === 0 ? `<span class="tag ok">${t('latest')}</span>` : ''}<span class="fine">${dateStr(new Date(v.date).getTime())}</span></div>
      ${v.new?.length ? `<p class="cl-k new">${t('newTag')}</p><ul>${v.new.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${v.fixed?.length ? `<p class="cl-k">${t('fixedTag')}</p><ul>${v.fixed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`, { sheet: true, label: t('changelog') });
}
function followSheet() {
  const f = S.config.officials.follow || {};
  const items = [['x', 'xlogo', 'X', h => `https://x.com/${h}`], ['instagram', 'instagram', 'Instagram', h => `https://instagram.com/${h}`], ['telegram', 'telegram', 'Telegram', h => `https://t.me/${h}`]].filter(([k]) => f[k]);
  openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('follow')}</h2>
    ${items.map(([k, ic, label, url]) => `<a class="follow-row" href="${esc(url(f[k]))}" target="_blank" rel="noopener">${icon(ic)}<span><b>${label}</b><small>${esc(url(f[k]).replace('https://', ''))}</small></span></a>`).join('')}</div>`, { sheet: true });
}
const videoHtml = (autoplay = false) => `<div class="explainer"><video src="/video/civiq-explainer.mp4" poster="/video/civiq-explainer.jpg" controls playsinline preload="${autoplay ? 'auto' : 'none'}" ${autoplay ? 'autoplay' : ''} aria-label="${esc(t('watchTitle'))}"></video></div>`;
function videoSheet() {
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('watchTitle')}</h2>${videoHtml(true)}
    <ol class="steps"><li><span>1</span>${t('how1')}</li><li><span>2</span>${t('how2')}</li><li><span>3</span>${t('how3')}</li></ol></div>`, { sheet: true, label: t('watchTitle') });
  m.el.querySelector('video')?.play().catch(() => {});
}
function aboutSheet() {
  const total = S.reports.length, cleared = S.reports.filter(r => r.status === 'resolved').length, wards = new Set(S.reports.map(r => r.wardNo).filter(Boolean)).size;
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body">
    <img src="/logo.svg" alt="CIVIQ" class="logo lg"><h2>${t('aboutTitle')}</h2><p class="lead">${t('aboutLead')}</p><p class="muted">${t('aboutBody')}</p>
    ${videoHtml()}
    <div class="stat-row"><div class="stat"><b>${fmt(total)}</b><span>${t('statReports')}</span></div><div class="stat ok"><b>${fmt(cleared)}</b><span>${t('statCleared')}</span></div><div class="stat plain"><b>${wards}/36</b><span>${t('statWards')}</span></div></div>
    <h4>${t('howTitle')}</h4><ol class="steps"><li><span>1</span>${t('how1')}</li><li><span>2</span>${t('how2')}</li><li><span>3</span>${t('how3')}</li></ol>
    <h4>${t('helpTitle')}</h4>
    <a class="follow-row" href="${esc(waShare(`${t('shareText')} ${location.origin}`))}" target="_blank" rel="noopener">${icon('share')}<span><b>${t('shareCiviq')}</b><small>${t('shareCiviqSub')}</small></span></a>
    <a class="follow-row" href="/communities" data-link>${icon('users')}<span><b>${t('commTitle')}</b><small>${t('commSubFallback')}</small></span></a>
    <a class="follow-row" href="/contact">${icon('building')}<span><b>${t('officialsTitle')}</b><small>${t('officialsSub')}</small></span></a>
    <a class="follow-row" href="/contact">${icon('mail')}<span><b>${t('feedbackTitle')}</b><small>${t('contact')}</small></span></a>
    <p class="fine center">${t('trust')}</p>
    <p class="fine center"><a href="/privacy">${t('privacy')}</a> · <a href="/terms">${t('terms')}</a> · <a href="/methodology">${t('methodology')}</a> · <a href="/status">${t('statusPage')}</a></p></div>`, { sheet: true, label: t('aboutTitle') });
  void m;
}
function digestSheet() {
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('digestTitle')}</h2><p class="muted">${t('digestPitch')}</p>
    <div class="chips static"><span>${t('chipStats')}</span><span>${t('chipWorst')}</span><span>${t('chipBacklogs')}</span><span>${t('chipMap')}</span></div>
    <form id="digestForm" novalidate><label class="lbl">${t('yourEmail')}<input class="input" type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
    <label class="lbl">${t('name')}<input class="input" name="name" autocomplete="name" placeholder="${esc(t('namePh'))}"></label>
    <div class="err-msg" data-err></div><button class="btn btn-primary btn-block">${t('subscribe')}</button><p class="fine center">${t('digestFooter')}</p></form></div>`, { sheet: true, label: t('digestTitle') });
  m.el.querySelector('#digestForm').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      const out = await api('/api/subscribe', { method: 'POST', body: { email: fd.get('email'), name: fd.get('name') } });
      m.el.querySelector('.sheet-body').innerHTML = `<div class="done-step"><div class="done-badge">${icon('check')}</div><h3>${t(out.status === 'already' ? 'subAlready' : out.status === 'resubscribed' ? 'subBack' : 'subNew')}</h3><p class="muted">${t('subBody')}</p>
        <button class="btn btn-primary btn-block" data-close>${t('done')}</button></div>`;
      store.set('civiq_digest_x', '1');
    } catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
  };
}
function intro() {
  const m = openModal(`<div class="sheet-body center intro"><img src="/logo.svg" alt="CIVIQ" class="logo lg">
    <h2>${t('introTitle')}</h2><p class="lead">${t('introSub')}</p><p class="muted">${t('introBody')}</p><p class="fine">${t('introFacts')}</p>
    <button class="btn btn-primary btn-block" data-close autofocus>${t('getStarted')}</button>
    <button class="link" data-video>${icon('play')} ${t('watchShort')}</button>
    <button class="link" data-lang>${icon('lang')} ${t('langSwitch')}</button></div>`, { label: t('introTitle'), onClose: () => store.set('civiq_intro', '1') });
  m.el.querySelector('[data-lang]').onclick = () => { m.close(); switchLang(); intro(); };
  m.el.querySelector('[data-video]').onclick = () => { m.close(); videoSheet(); };
}

// ================= report page =================
async function reportView(id) {
  let r = S.reports.find(x => x.id === id);
  if (!r) { show(`${head('')}<div class="pad center"><span class="spin"></span></div>`); try { r = await api(`/api/reports/${id}`); } catch { return notFound('report'); } }
  if (state.route !== `/report/${id}`) return;
  renderReport(r);
  S.map?.flyTo({ center: [r.lng, r.lat], zoom: Math.max(S.map.getZoom(), 15.5), padding: isMobile() ? { bottom: innerHeight * 0.55 } : {}, speed: 1.6 });
}
function ladder(r) {
  const d = daysSince(r.createdAt), wp = S.config.wardPeople, z = wp.zones[r.zone], o = S.config.officials;
  const link = `${location.origin}/report/${r.id}`;
  const msg = `Garbage at ${r.landmark || r.locality}${r.wardNo ? `, Ward ${r.wardNo}` : ''}, Gurugram, open ${d} days. Photo and location: ${link}`;
  let key, actions;
  if (d < 2 || !z) { key = 'new'; actions = `<a class="btn btn-primary" href="${tel(o.helplines[0].number)}">${icon('phone')}${t('callHelpline')}</a>${z ? `<a class="btn btn-ghost" href="${tel(z.ssi.phone)}">${t('callSsi')}</a>` : ''}`; }
  else if (d < 5) { key = 'ssi'; actions = `<a class="btn btn-primary" href="${tel(z.ssi.phone)}">${icon('phone')}${t('callSsi')}</a><a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/91${z.ssi.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(msg)}">${icon('whatsapp')}WhatsApp</a>`; }
  else if (d < 10) { key = 'jc'; actions = `<a class="btn btn-primary" href="${tel(z.jc.phone)}">${icon('phone')}${t('callJc')}</a><a class="btn btn-ghost" href="mailto:${z.jc.email}?subject=${encodeURIComponent(`Garbage open ${d} days · Ward ${r.wardNo}`)}&body=${encodeURIComponent(msg)}">${icon('mail')}Email</a>`; }
  else if (d < 20) { key = 'commissioner'; actions = `<a class="btn btn-primary" href="mailto:${wp.city.commissioner.email}?subject=${encodeURIComponent(`Garbage open ${d} days · Ward ${r.wardNo}`)}&body=${encodeURIComponent(msg)}">${icon('mail')}${t('emailCommissioner')}</a><a class="btn btn-ghost" href="${tel(wp.city.commissioner.phone)}">${icon('phone')}</a>`; }
  else { key = 'public'; actions = `<a class="btn btn-dark" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(`This garbage dump in Ward ${r.wardNo || ''}, Gurugram has been open for ${d} days. @${o.x_handle} ${link}`)}">${icon('xlogo')}${t('postX')}</a><a class="btn btn-ghost" href="${tel(o.helplines[0].number)}">${icon('phone')}</a>`; }
  return `<div class="box2 todo ${key === 'public' ? 'hot' : ''}"><h4>${t('todoHeader')}</h4><p class="todo-when">${d === 0 ? t('todoToday') : d === 1 ? t('todoYesterday') : `${d} ${t('daysOpen').toLowerCase()}`}</p>
    <p>${t(`todo_${key}`)}</p><div class="row-btns">${actions}</div></div>`;
}
function threshold(r) {
  if (!r.wardNo) return '';
  const openW = S.reports.filter(x => x.wardNo === r.wardNo && x.status === 'open');
  if (openW.length < S.config.wardThreshold) return '';
  const c = S.config.wardPeople.councillors[r.wardNo], seat = r.constituency, mla = seat && S.config.officials.mlas[seat];
  const top = [...openW].sort((a, b) => a.createdAt - b.createdAt).slice(0, 5);
  const text = [`URGENT: ${openW.length} unresolved garbage complaints, Ward ${r.wardNo}, Gurugram`, `Ward: ${r.wardNo} (Councillor ${c?.name || '-'})`, `Zone: ${r.zone || '-'}`,
    seat ? `Assembly constituency: ${seat}` : '', mla ? `MLA: ${mla.name} (${mla.party})` : '',
    `Citizens have reported ${openW.length} unresolved garbage dumps in this ward. Top locations:`, ...top.map((x, i) => `${i + 1}. ${x.landmark || x.locality} (${daysSince(x.createdAt)} days)`),
    `This ward has crossed the ${S.config.wardThreshold}-report threshold. Immediate cleanup is requested.`, `Full ward report: ${location.origin}/ward/${r.wardNo}`, 'Reported via CIVIQ, crowdsourced garbage mapping for Gurugram'].filter(Boolean).join('\n');
  return `<div class="box2 thresh"><h4>${icon('alert')} ${t('thresholdTitle')}</h4><p>${t('thresholdBody', { w: r.wardNo, n: openW.length })}</p>
    <a class="btn btn-wa btn-block" target="_blank" rel="noopener" href="${esc(waShare(text))}">${icon('whatsapp')}${t('thresholdCta')}</a><p class="fine">${t('thresholdNote')}</p></div>`;
}
function renderReport(r) {
  const open = r.status === 'open', d = daysSince(r.createdAt), seenKey = `civiq_seen_${r.id}`, seen = !!store.get(seenKey);
  const cleanedTxt = r.resolvedAt ? (() => { const n = Math.max(0, Math.round((r.resolvedAt - r.createdAt) / DAY)); return n === 0 ? t('cleanedSameDay') : n === 1 ? t('cleanedNextDay') : t('cleanedAfterDays', { n }); })() : '';
  select(r, r.wardNo ? [r.wardNo] : []);
  show(`${head(open ? (r.resolutionPending ? t('underReview') : t('unresolved')) : t('cleanedTag'), `<button class="x" data-share aria-label="${t('share')}">${icon('share')}</button>`)}
    ${open ? `<button class="hero" data-photo="0"><img src="${esc(r.photo)}" alt="${esc(t('reportGarbage'))}">
        <span class="over"><span class="tag"><i class="sev-dot sev-${r.severity}"></i>${sevLabel(r.severity)}</span><span class="tag red">${icon('clock')}${d ? `${d} ${t('daysOpen').toLowerCase()}` : t('todoToday')}</span></span>
        <span class="saw ${seen ? 'on' : ''}" data-saw role="button" tabindex="0">${icon(seen ? 'check' : 'eye')}${seen ? t('sawDone') : t('sawToo')}</span></button>`
      : `<div class="ba"><button class="hero" data-photo="0"><img src="${esc(r.photo)}" alt="${t('before')}"><span class="over"><span class="tag">${t('before')}</span></span></button>
        <button class="hero" data-photo="1"><img src="${esc(r.resolvedPhoto)}" alt="${t('after')}"><span class="over"><span class="tag ok">${icon('check')}${t('after')}</span></span></button></div>
        <p class="clean-story">${icon('check')} ${cleanedTxt} · ${t('verifiedByCitizen')}</p>`}
    ${r.resolutionPending ? `<div class="box2 review">${icon('clock')}<span><b>${t('resolutionReview')}</b><small>${t('resolutionReviewBody')}</small></span></div>` : ''}
    ${r.disputePending ? `<div class="box2 review">${icon('flag')}<span><b>${t('disputeReview')}</b><small>${t('disputeReviewBody')}</small></span></div>` : ''}
    ${r.isExample ? `<div class="box2 example-box">${icon('info')}<span><b>${t('exampleTitle')}</b><small>${t('exampleBody')}</small>${r.photoCredit ? `<small class="credit">${t('photoCredit', { a: esc(r.photoCredit.author || 'Unknown'), l: esc(r.photoCredit.license) })} · <a href="${esc(r.photoCredit.page)}" target="_blank" rel="noopener">source</a>${r.photoCredit.after ? ` · after photo: <a href="${esc(r.photoCredit.after.page)}" target="_blank" rel="noopener">${esc(r.photoCredit.after.author || 'source')}</a>` : ''}</small>` : ''}</span></div>` : `<p class="fine center">${icon('shield')} ${t('anonymous')}</p>`}
    <h2 class="d-title">${esc(r.landmark || r.locality)}</h2>
    <p class="d-sub">${esc(r.locality)}${r.wardNo ? ` · <a href="/ward/${r.wardNo}" data-link>${t('kickerWard')} ${esc(r.wardNo)}</a>` : ''}</p>
    <a class="dir" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}">${icon('nav')}${t('getDirections')}</a>
    <div class="facts"><div class="fact"><b>${r.seenCount + 1}</b><span>${t('peopleSaw')}</span></div><div class="fact"><b>${open ? d : Math.max(0, Math.round((r.resolvedAt - r.createdAt) / DAY))}</b><span>${open ? t('daysOpen') : t('cleanedTag')}</span></div>
      <div class="fact"><b class="sm">${esc(wasteLabel(r.wasteType))}</b><span>${t('wasteType')}</span></div></div>
    <div class="chips-row"><span class="tag">${esc(probLabel(r.complaintType))}</span></div>
    ${open ? ladder(r) + threshold(r) : ''}
    ${responsibleHtml({ wardNo: r.wardNo, zone: r.zone, seat: r.constituency, r, problem: r.complaintType })}
    <p class="meta">${t('reportedAgo', { t: ago(r.createdAt) })} · ${r.seenCount ? t('seenByN', { n: r.seenCount + 1 }) : t('seenBy1')}${open ? ` · ${d}d` : ''}</p>
    ${open ? `<div class="d-foot"><button class="btn btn-ghost" data-dispute>${icon('flag')}${t('notGarbage')}</button><button class="btn btn-green" data-verify>${icon('check')}${t('verifyCleanup')}</button></div>` : ''}`,
    { title: `${r.landmark || r.locality} · CIVIQ` });
  view.querySelector('[data-share]').onclick = () => shareSheet(r);
  view.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', e => {
    if (e.target.closest('[data-saw]')) return;
    const ph = [{ src: r.photo, cap: t('before') }, ...(r.resolvedPhoto ? [{ src: r.resolvedPhoto, cap: t('after') }] : [])];
    lightbox(ph, +b.dataset.photo);
  }));
  view.querySelector('[data-saw]')?.addEventListener('click', async e => {
    e.stopPropagation(); if (seen) return;
    try { const u = await api(`/api/reports/${r.id}/seen`, { method: 'POST', body: { device: (await import('./common.js')).deviceId() } }); store.set(seenKey, '1'); mergeReport(u); renderReport(u); toast(t('sawDone')); }
    catch (ex) { toast(ex.message, false); }
  });
  view.querySelector('[data-verify]')?.addEventListener('click', () => r.resolutionPending ? toast(t('resolutionReviewBody'), false) : spotFlow(r, 'resolve'));
  view.querySelector('[data-dispute]')?.addEventListener('click', () => spotFlow(r, 'dispute'));
}

// ================= ward / MLA / MP / zone pages =================
function areaModel(type, id) {
  const wp = S.config.wardPeople, o = S.config.officials;
  if (type === 'ward') {
    if (!wp.councillors[id]) return null;
    const f = featureWard(id), zone = f?.properties.zone, seat = wardSeat(id);
    return { type, kicker: t('kickerWard'), title: `${t('kickerWard')} ${id}`, sub: [zone, seat && t('constituencyOf', { s: seat })].filter(Boolean).join(' · '),
      wards: [id], filter: r => r.wardNo === id, zone, seat, localities: f?.properties.localities };
  }
  if (type === 'mla') {
    const m = o.mlas[id]; if (!m) return null;
    return { type, kicker: t('kickerMla'), title: m.name, sub: `${t('mla')} · ${id} · ${m.party}`, wards: wardsOfSeat(id), filter: r => r.constituency === id, seat: id };
  }
  if (type === 'mp') return { type, kicker: t('kickerMp'), title: o.mp.name, sub: `${t('mp')} · ${o.mp.seat} (Lok Sabha) · ${o.mp.party}`, wards: (S.wards?.features || []).map(f => String(f.properties.ward_no)), filter: () => true };
  if (type === 'zone') {
    const z = zoneFromNo(id); if (!z) return null;
    return { type, kicker: t('kickerZone'), title: z, sub: `${t('jc')}: ${wp.zones[z].jc.name}`, wards: wardsOfZone(z), filter: r => r.zone === z, zone: z };
  }
  return null;
}
function areaView(type, id, opts = {}) {
  if (!S.wards) { show(`${head('')}<div class="pad center"><span class="spin"></span></div>`); setTimeout(() => state.route.startsWith(`/${type}`) && areaView(type, id, opts), 400); return; }
  const a = areaModel(type, id); if (!a) return notFound(type === 'ward' ? 'ward' : 'mla');
  const tab = opts.tab || 'reports', sort = opts.sort || 'newest', sev = opts.sev || '', st = opts.st || 'open', limit = opts.limit || 30;
  const rows = S.reports.filter(a.filter), open = rows.filter(r => r.status === 'open'), cleared = rows.filter(r => r.status === 'resolved');
  const ages = open.map(r => daysSince(r.createdAt)).sort((x, y) => x - y);
  const medWait = ages.length ? ages[ages.length >> 1] : 0;
  const last = rows.length ? Math.max(...rows.map(r => r.createdAt)) : null;
  const wp = S.config.wardPeople, o = S.config.officials, z = wp.zones[a.zone];
  // actions
  const pageUrl = `${location.origin}${location.pathname}`;
  const shareTxt = `${a.title}, Gurugram: ${open.length} open garbage reports on CIVIQ. ${pageUrl}`;
  const acts = [];
  if (type === 'ward' && z) acts.push(`<a class="btn btn-primary" href="${tel(z.ssi.phone)}">${icon('phone')}${t('callSsi')}</a>`, `<a class="btn btn-ghost" href="${tel(z.jc.phone)}">${t('callJc')}</a>`);
  if (type === 'zone' && z) acts.push(`<a class="btn btn-primary" href="${tel(z.jc.phone)}">${icon('phone')}${t('callJc')}</a>`, `<a class="btn btn-ghost" href="${tel(z.ssi.phone)}">${t('callSsi')}</a>`);
  acts.push(`<a class="btn btn-ghost" href="${tel(o.helplines[0].number)}">${icon('phone')}${o.helplines[0].number}</a>`, `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waShare(shareTxt))}">${icon('whatsapp')}${t('share')}</a>`);
  // reps
  const reps = [];
  if (type === 'ward') { const c = wp.councillors[id]; reps.push(contactCard({ av: initials(c.name), name: c.name, role: `${t('councillor')} · ${t('kickerWard')} ${id}`, email: c.email })); }
  if ((type === 'ward' || type === 'mla') && a.seat) { const m = o.mlas[a.seat]; reps.push(contactCard({ photo: m.photo, av: initials(m.name), name: m.name, role: `${t('mla')} · ${a.seat} · ${m.party}`, href: `/mla/${encodeURIComponent(a.seat)}` })); }
  if (type !== 'zone') reps.push(contactCard({ photo: o.mp.photo, av: initials(o.mp.name), name: o.mp.name, role: `${t('mp')} · ${o.mp.seat} · ${o.mp.party}`, href: '/mp/gurgaon' }));
  if (type === 'zone' && z) reps.push(contactCard({ av: 'JC', name: z.jc.name, role: `${t('jc')} · ${a.zone}`, phone: z.jc.phone, email: z.jc.email, primary: true }), contactCard({ av: 'SSI', name: z.ssi.name, role: `${t('ssi')} · ${a.zone}`, phone: z.ssi.phone, email: z.ssi.email }), contactCard({ av: 'EE', name: z.ee.name, role: `${t('ee')} · ${a.zone}`, phone: z.ee.phone, email: z.ee.email }));
  // list
  let list = (tab === 'cleared' ? cleared : rows.filter(r => !st || r.status === st)).filter(r => !sev || r.severity === sev);
  list.sort(sort === 'oldest' ? (x, y) => x.createdAt - y.createdAt : sort === 'seen' ? (x, y) => y.seenCount - x.seenCount : (x, y) => y.createdAt - x.createdAt);
  const grid = list.length ? `<div class="pgrid">${list.slice(0, limit).map(photoCard).join('')}</div>${list.length > limit ? `<button class="more" data-more>${t('showMore', { n: Math.min(30, list.length - limit) })}</button>` : ''}`
    : `<div class="empty">${tab === 'cleared' ? t('emptyCleared', { n: open.length }) : rows.length && !open.length && st === 'open' ? t('allClearedHere') : t('emptyReports')}</div>`;
  // insights
  const bySize = S.config.severities.map(s => ({ k: s, n: open.filter(r => r.severity === s).length }));
  const ageB = [[t('age_week'), x => x < 7], [t('age_month'), x => x >= 7 && x < 28], [t('age_quarter'), x => x >= 28 && x < 90], [t('age_older'), x => x >= 90]].map(([l, fn]) => ({ l, n: ages.filter(fn).length }));
  const weeks = [...Array(12)].map((_, i) => { const end = Date.now() - (11 - i) * 7 * DAY, start = end - 7 * DAY; return rows.filter(r => r.createdAt > start && r.createdAt <= end).length; });
  const wmax = Math.max(1, ...weeks);
  const hot = [];
  for (const r of open) { if (hot.some(h => h.near.includes(r.id))) continue; const near = open.filter(x => x.id !== r.id && Math.hypot((x.lat - r.lat) * 111000, (x.lng - r.lng) * 98000) < 50); if (near.length) hot.push({ r, n: near.length + 1, near: near.map(x => x.id), first: Math.min(r.createdAt, ...near.map(x => x.createdAt)) }); }
  const worst = a.wards.length > 1 ? a.wards.map(w => ({ w, n: open.filter(r => r.wardNo === w).length })).filter(x => x.n).sort((x, y) => y.n - x.n).slice(0, 5) : [];
  const bar = (label, n, max, cls = '') => `<div class="bar"><span>${esc(label)}</span><div class="track"><div class="fill ${cls}" style="width:${max ? n / max * 100 : 0}%"></div></div><span class="n">${fmt(n)}</span></div>`;
  const insights = `
    <div class="box2"><h4>${t('bySize')}</h4><div class="bars">${bySize.map(x => bar(sevLabel(x.k), x.n, Math.max(1, ...bySize.map(y => y.n)), `sev-${x.k}`)).join('')}</div></div>
    <div class="box2"><h4>${t('ageing')}</h4><div class="age-grid">${ageB.map(x => `<div><b>${x.n}</b><small>${x.l}</small></div>`).join('')}</div></div>
    <div class="box2"><h4>${t('perWeek')}</h4><div class="spark">${weeks.map((n, i) => `<i style="height:${Math.max(4, n / wmax * 100)}%" title="${n}"${i === 11 ? ' class="now"' : ''}></i>`).join('')}</div><p class="fine">${t('thisWeek')} · ${weeks[11]}</p></div>
    ${hot.length ? `<div class="box2"><h4>${t('hotspots')}</h4>${hot.slice(0, 5).map(h => `<a class="row-link" href="/report/${h.r.id}" data-link><span class="thumb" style="background-image:url('${esc(h.r.photo)}')"></span><span><b>${esc(h.r.landmark || h.r.locality)}</b><small>${h.n} reports · ${t('hotspotSub', { d: daysSince(h.first) })}</small></span></a>`).join('')}</div>` : ''}
    ${worst.length ? `<div class="box2"><h4>${t('worstWards')}</h4>${worst.map((x, i) => `<a class="row-link" href="/ward/${x.w}" data-link><span class="rank-no">${i + 1}</span><span><b>${t('kickerWard')} ${x.w} · ${esc(wp.councillors[x.w]?.name || '')}</b><small>${esc(featureWard(x.w)?.properties.zone || '')}</small></span><span class="n red">${x.n}</span></a>`).join('')}</div>` : ''}
    ${type === 'mp' ? `<div class="box2"><h4>${t('assemblySeats')} · ${Object.keys(o.mlas).length}</h4>${Object.entries(o.mlas).map(([seat, m], i) => `<a class="row-link" href="/mla/${encodeURIComponent(seat)}" data-link><span class="rank-no num">${i + 1}</span><span><b>${esc(seat)}</b><small>${esc(m.name)} · ${m.party}</small></span><span class="n red">${S.reports.filter(r => r.constituency === seat && r.status === 'open').length}</span></a>`).join('')}</div>` : ''}
    ${a.wards.length > 1 && type !== 'mp' ? `<div class="box2"><h4>${t('wardsList')} · ${a.wards.length}</h4><div class="ward-chips">${a.wards.sort((x, y) => x - y).map((w, i) => `<a href="/ward/${w}" data-link><span class="num">${i + 1}</span>${t('kickerWard')} ${w}</a>`).join('')}</div></div>` : ''}
    ${a.localities ? `<div class="box2"><h4>${t('wardsHead')} · MCG</h4><p class="muted sm">${esc(a.localities)}</p><p class="fine">Ward edges on the map are approximate; the locality list is MCG's.</p></div>` : ''}`;
  show(`${head(a.kicker)}
    <div class="area-head">${(() => { const p = type === 'mla' ? o.mlas[id]?.photo : type === 'mp' ? o.mp.photo : null; const cr = type === 'mla' ? o.mlas[id]?.photoCredit : type === 'mp' ? o.mp.photoCredit : ''; return p ? `<img class="portrait" src="${esc(p)}" alt="${esc(a.title)}" title="Photo: ${esc(cr)}">` : ''; })()}
      <div><p class="kicker">${esc(a.kicker)}</p><h2 class="d-title big">${esc(a.title)}</h2><p class="d-sub">${esc(a.sub)}${a.wards.length > 1 ? ` · ${t('wardsCount', { n: a.wards.length })}` : ''}</p></div></div>
    <button class="area-stats" data-insights><span><b class="red">${fmt(open.length)}</b><small>${t('open').toLowerCase()}</small></span><span><b class="ok">${fmt(cleared.length)}</b><small>${t('cleared').toLowerCase()}</small></span>
      <span><b>${medWait}</b><small>${t('daysWait')}</small></span><span><b class="sm">${last ? ago(last) : '–'}</b><small>${t('lastReport')}</small></span><em>${t('moreInsights')} ${icon('down')}</em></button>
    <div class="row-btns wrap">${acts.join('')}</div>
    <div class="seg3" role="tablist">${['reports', 'insights', 'cleared'].map(k => `<button role="tab" class="${tab === k ? 'on' : ''}" data-tab="${k}">${t(k === 'reports' ? 'tabReports' : k === 'insights' ? 'tabInsights' : 'tabCleared')}</button>`).join('')}</div>
    ${tab === 'insights' ? insights : `${tab === 'reports' ? `<div class="filterbar">
      <select data-st aria-label="${t('status')}"><option value="open" ${st === 'open' ? 'selected' : ''}>${t('unresolved')}</option><option value="resolved" ${st === 'resolved' ? 'selected' : ''}>${t('resolved')}</option><option value="" ${!st ? 'selected' : ''}>${t('all')}</option></select>
      <select data-sev aria-label="${t('severity')}"><option value="">${t('allSeverity')}</option>${S.config.severities.map(s => `<option value="${s}" ${sev === s ? 'selected' : ''}>${sevLabel(s)}</option>`).join('')}</select>
      <select data-sort aria-label="Sort"><option value="newest" ${sort === 'newest' ? 'selected' : ''}>${t('sortNewest')}</option><option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>${t('sortOldest')}</option><option value="seen" ${sort === 'seen' ? 'selected' : ''}>${t('sortSeen')}</option></select></div>
      <p class="fine">${t('showingOf', { a: Math.min(limit, list.length), b: list.length })}</p>` : ''}${grid}`}
    <div class="box2"><h4>${t('electedFor')}</h4>${reps.join('')}</div>`, { title: `${a.title}, Gurugram: ${open.length} open garbage reports · CIVIQ` });
  const again = patch => areaView(type, id, { tab, sort, sev, st, limit, ...patch });
  view.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => again({ tab: b.dataset.tab, limit: 30 }));
  view.querySelector('[data-insights]').onclick = () => again({ tab: 'insights' });
  view.querySelector('[data-st]')?.addEventListener('change', e => again({ st: e.target.value, limit: 30 }));
  view.querySelector('[data-sev]')?.addEventListener('change', e => again({ sev: e.target.value, limit: 30 }));
  view.querySelector('[data-sort]')?.addEventListener('change', e => again({ sort: e.target.value }));
  view.querySelector('[data-more]')?.addEventListener('click', () => again({ limit: limit + 30 }));
  view.querySelectorAll('.pgrid [data-id]').forEach(c => c.onclick = () => go(`/report/${c.dataset.id}`));
  // map
  select(null, a.wards); if (!opts.tab) fitWards(a.wards);
  clearMarkers();
  if (type === 'mp') Object.keys(o.mlas).forEach((seat, i) => { const ws = wardsOfSeat(seat); const b = new maplibregl.LngLatBounds(); ws.forEach(w => featureWard(w)?.geometry.coordinates.flat(2).forEach(c => b.extend(c))); if (!b.isEmpty()) numberMarker(b.getCenter(), i + 1, `/mla/${encodeURIComponent(seat)}`, seat); });
  else if (a.wards.length > 1) [...a.wards].sort((x, y) => x - y).forEach((w, i) => { const c = wardCenter(w); if (c) numberMarker(c, i + 1, `/ward/${w}`, `${t('kickerWard')} ${w}`); });
}

// ================= leaderboard =================
function leaderboardView(q = '') {
  const open = S.reports.filter(r => r.status === 'open').length, res = S.reports.filter(r => r.status === 'resolved').length, total = S.reports.length;
  const wp = S.config.wardPeople;
  const rows = Object.keys(wp.councillors).map(w => { const rs = S.reports.filter(r => r.wardNo === w); const o = rs.filter(r => r.status === 'open').length; return { w, total: rs.length, open: o, pct: rs.length ? Math.round((rs.length - o) / rs.length * 100) : 0, zone: featureWard(w)?.properties.zone || '' }; })
    .filter(x => !q ? x.total : (`ward ${x.w} ${wp.councillors[x.w].name} ${featureWard(x.w)?.properties.localities}`.toLowerCase().includes(q.toLowerCase()) || x.w === q.trim()))
    .sort((a, b) => b.open - a.open || b.total - a.total);
  show(`${head(t('lbTitle'))}<h2 class="d-title">${t('lbTitle')}</h2><p class="d-sub">${t('lbSub')}</p>
    <div class="stat-row"><div class="stat"><b>${fmt(open)}</b><span>${t('unresolved')}</span></div><div class="stat ok"><b>${fmt(res)}</b><span>${t('resolved')}</span></div>
      <div class="stat plain" title="${esc(t('rateExplainer'))}"><b>${total ? (res / total * 100).toFixed(1) : 0}%</b><span>${t('rate')} ${icon('info', 'xs')}</span></div></div>
    <p class="fine">${t('seeMoreOn')} <a href="/analytics">${t('analytics')}</a></p>
    <div class="search sm">${icon('search')}<input id="lbq" type="search" placeholder="${esc(t('searchWard'))}" value="${esc(q)}"></div>
    <h4 class="mt">${t('worstWardsUnresolved')}</h4>
    <div class="lb">${rows.length ? rows.map((x, i) => `<a class="row-link" href="/ward/${x.w}" data-link><span class="rank-no">${i + 1}</span><span><b>${t('kickerWard')} ${x.w} · ${esc(wp.councillors[x.w].name)}</b><small>${esc(x.zone)} · ${t('reportsResolved', { n: x.total, p: x.pct })}</small></span><span class="n red">${x.open}</span></a>`).join('') : `<div class="empty">${t('noReportsYet')}</div>`}</div>`,
    { title: 'All 36 wards of Gurugram · CIVIQ' });
  const inp = $('#lbq'); inp.oninput = () => { const v = inp.value; leaderboardView(v); const n = $('#lbq'); n.focus(); n.setSelectionRange(v.length, v.length); };
  select(null, []);
}

// ================= communities =================
function updateCommunityDot() {
  const dot = $('#commDot'); if (!dot) return;
  const w = S.userLoc && wardAtPoint(S.userLoc.lng, S.userLoc.lat);
  dot.classList.toggle('hidden', !(w && S.communities.some(c => c.allCity || c.wards.includes(String(w)))));
}
const LINK_IC = { whatsapp: 'whatsapp', instagram: 'instagram', facebook: 'facebook', x: 'xlogo', website: 'globe', linkedin: 'linkedin', youtube: 'youtube', telegram: 'telegram' };
const linkLabel = (k, v) => k === 'instagram' ? v.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '') : k === 'whatsapp' ? 'WhatsApp' : k === 'website' ? v.replace(/^https?:\/\//, '').replace(/\/$/, '') : k[0].toUpperCase() + k.slice(1);
const safeUrl = u => /^https?:\/\//i.test(u) ? u : `https://${u}`;
async function communitiesView() {
  S.communities = await api('/api/communities').catch(() => S.communities);
  const myWard = S.userLoc && wardAtPoint(S.userLoc.lng, S.userLoc.lat);
  show(`${head(t('commTitle'))}<h2 class="d-title">${t('commTitle')}</h2><p class="d-sub">${S.communities.length ? t('commSub', { n: S.communities.length }) : t('commSubFallback')}</p>
    ${S.communities.length ? S.communities.map(c => `<article class="comm"><div class="comm-h"><img src="${esc(c.logo)}" alt="" class="comm-logo"><span><b>${esc(c.name)}</b>
      <small>${icon('pin', 'xs')} ${c.allCity ? t('worksAcross') : c.wards.map(w => `${t('kickerWard')} ${w}`).join(', ')}</small>${myWard && (c.allCity || c.wards.includes(String(myWard))) ? `<span class="tag ok">${t('activeInWard', { w: myWard })}</span>` : ''}</span></div>
      <p class="sm">${esc(c.focus)}</p>${c.about ? `<p class="muted sm">${esc(c.about)}</p>` : ''}
      <div class="link-chips">${Object.entries(c.links).map(([k, v]) => `<a href="${esc(safeUrl(v))}" target="_blank" rel="noopener nofollow">${icon(LINK_IC[k])}${esc(linkLabel(k, v))}</a>`).join('')}</div></article>`).join('')
      : `<div class="empty">${t('commEmpty')}</div>`}
    <a class="btn btn-ghost btn-block" href="/communities/register" data-link>${icon('plus')}${t('registerCta')}</a>`, { title: 'Volunteer communities cleaning up Gurugram · CIVIQ' });
}
function registerView() {
  const wp = S.config.wardPeople, f = { wards: [], allCity: false, links: { whatsapp: '', instagram: '' }, logo: null };
  show(`${head(t('regTitle'))}<h2 class="d-title">${t('regTitle')}</h2><p class="d-sub">${t('regSub')}</p>
    <form id="reg" novalidate>
      <label class="lbl">${t('fName')} *<input class="input" name="name" maxlength="80" placeholder="${esc(t('fNamePh'))}"></label>
      <label class="lbl">${t('fFocus')} *<input class="input" name="focus" maxlength="120" placeholder="${esc(t('fFocusPh'))}"></label>
      <label class="lbl">${t('fAbout')}<textarea class="input" name="about" maxlength="600" rows="3" placeholder="${esc(t('fAboutPh'))}"></textarea><small>${t('fAboutHelp')}</small></label>
      <fieldset class="lbl"><legend>${t('fWhere')} *</legend><label class="check"><input type="checkbox" name="allCity"> ${t('fAllCity')}</label>
        <div data-wardpick><input class="input" data-wq placeholder="${esc(t('fWardSearch'))}"><div class="ward-pick" data-wl></div><div class="chips" data-sel></div></div><small>${t('fWhereHelp')}</small></fieldset>
      <fieldset class="lbl"><legend>${t('fLinks')} *</legend><div data-links></div><div class="link-adders" data-adders></div><small>${t('fLinksHelp')} ${t('fLinksAdd')}</small></fieldset>
      <fieldset class="lbl"><legend>${t('fLogo')} *</legend><div class="logo-pick"><img data-logo class="comm-logo lg hidden" alt=""><label class="btn btn-ghost">${icon('camera')}<span data-logo-l>${t('fLogoUpload')}</span><input type="file" accept="image/*" class="sr-only" data-file></label></div><small>${t('fLogoHelp')}</small></fieldset>
      <fieldset class="lbl"><legend>${t('fContact')} *</legend><small>${t('fContactHelp')}</small><input class="input" name="contactName" placeholder="${esc(t('fContactName'))}" autocomplete="name"><input class="input mt" name="contactPhone" type="tel" placeholder="${esc(t('fContactPhone'))}" autocomplete="tel"></fieldset>
      <p class="fine">${t('reviewNote')}</p><div class="err-msg" data-err></div>
      <div class="row-btns"><button type="button" class="btn btn-ghost" data-back2>${t('cancel')}</button><button class="btn btn-primary">${t('submit')}</button></div></form>`, { title: 'Register your community · CIVIQ' });
  const form = $('#reg');
  form.querySelector('[data-back2]').onclick = back;
  const renderSel = () => { form.querySelector('[data-sel]').innerHTML = f.wards.map(w => `<button type="button" class="on" data-rm="${w}">${t('kickerWard')} ${w} ×</button>`).join(''); };
  form.querySelector('[data-wq]').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    const hits = q ? Object.keys(wp.councillors).filter(w => w === q || `ward ${w} ${wp.councillors[w].name} ${featureWard(w)?.properties.localities || ''}`.toLowerCase().includes(q)).slice(0, 6) : [];
    form.querySelector('[data-wl]').innerHTML = hits.map(w => `<button type="button" data-add="${w}">${t('kickerWard')} ${w} · ${esc(featureWard(w)?.properties.localities.split(',').slice(0, 2).join(',') || '')}</button>`).join('');
  };
  form.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'); if (add && !f.wards.includes(add.dataset.add)) { f.wards.push(add.dataset.add); renderSel(); form.querySelector('[data-wq]').value = ''; form.querySelector('[data-wl]').innerHTML = ''; }
    const rm = e.target.closest('[data-rm]'); if (rm) { f.wards = f.wards.filter(w => w !== rm.dataset.rm); renderSel(); }
    const ad = e.target.closest('[data-addlink]'); if (ad) { f.links[ad.dataset.addlink] = ''; renderLinks(); }
    const rl = e.target.closest('[data-rmlink]'); if (rl) { delete f.links[rl.dataset.rmlink]; renderLinks(); }
  });
  form.allCity.onchange = () => { f.allCity = form.allCity.checked; form.querySelector('[data-wardpick]').classList.toggle('hidden', f.allCity); };
  function renderLinks() {
    form.querySelector('[data-links]').innerHTML = Object.entries(f.links).map(([k, v]) => `<div class="link-in">${icon(LINK_IC[k])}<input class="input" data-lk="${k}" value="${esc(v)}" placeholder="${esc(t(`link_${k}`))}"><button type="button" class="x sm" data-rmlink="${k}" aria-label="Remove">${icon('x')}</button></div>`).join('');
    form.querySelector('[data-adders]').innerHTML = S.config.linkPlatforms.filter(k => !(k in f.links)).map(k => `<button type="button" class="mini" data-addlink="${k}" title="${esc(t(`link_${k}`))}">${icon(LINK_IC[k])}</button>`).join('');
    form.querySelectorAll('[data-lk]').forEach(i => i.oninput = () => { f.links[i.dataset.lk] = i.value; });
  }
  renderLinks();
  form.querySelector('[data-file]').onchange = e => { const file = e.target.files[0]; if (!file) return; if (!file.type.startsWith('image/')) return toast('Please choose an image file.', false); if (file.size > 10e6) return toast('That image is too large. Please pick one under 10MB.', false); cropLogo(file, out => { f.logo = out; const img = form.querySelector('[data-logo]'); img.src = out; img.classList.remove('hidden'); form.querySelector('[data-logo-l]').textContent = t('fLogoChange'); }); };
  form.onsubmit = async e => {
    e.preventDefault(); const err = form.querySelector('[data-err]'); err.textContent = '';
    const body = { name: form.name.value, focus: form.focus.value, about: form.about.value, allCity: f.allCity, wards: f.wards, links: f.links, logo: f.logo, contactName: form.contactName.value, contactPhone: form.contactPhone.value };
    try {
      await api('/api/communities', { method: 'POST', body });
      show(`${head(t('regTitle'))}<div class="done-step"><div class="done-badge">${icon('check')}</div><h3>${t('regDoneTitle')}</h3><p class="muted">${t('regDoneBody')}</p><a class="btn btn-primary" href="/communities" data-link>${t('done')}</a></div>`);
    } catch (ex) { err.textContent = ex.message; }
  };
}
function cropLogo(file, done) {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const m = openModal(`<div class="sheet-body center"><h2>${t('cropTitle')}</h2><p class="muted">${t('cropHelp')}</p><div class="crop"><canvas width="512" height="512"></canvas></div>
      <input type="range" min="1" max="4" step="0.01" value="1" class="zoom" aria-label="Zoom"><div class="row-btns"><button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" data-use>${t('useThis')}</button></div></div>`, { sheet: true });
    const c = m.el.querySelector('canvas'), g = c.getContext('2d'), zoom = m.el.querySelector('.zoom');
    const base = 512 / Math.min(img.width, img.height); let s = 1, x = 0, y = 0;
    const draw = () => { const k = base * s, w = img.width * k, h = img.height * k; x = Math.min(0, Math.max(512 - w, x)); y = Math.min(0, Math.max(512 - h, y)); g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 512); g.drawImage(img, x, y, w, h); };
    x = (512 - img.width * base) / 2; y = (512 - img.height * base) / 2; draw();
    zoom.oninput = () => { const cx = 256, cy = 256, ns = +zoom.value; x = cx - (cx - x) * ns / s; y = cy - (cy - y) * ns / s; s = ns; draw(); };
    let drag = null; const scale = () => 512 / c.getBoundingClientRect().width;
    c.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); };
    c.onpointermove = e => { if (!drag) return; x += (e.clientX - drag.x) * scale(); y += (e.clientY - drag.y) * scale(); drag = { x: e.clientX, y: e.clientY }; draw(); };
    c.onpointerup = () => { drag = null; };
    m.el.querySelector('[data-use]').onclick = () => { done(c.toDataURL('image/jpeg', 0.88)); m.close(); URL.revokeObjectURL(url); };
  };
  img.src = url;
}

// ================= not found =================
function notFound(kind) {
  const k = { report: ['notFoundReport', 'notFoundReportBody'], ward: ['notFoundWard', 'notFoundWardBody'], mla: ['notFoundMla', 'notFoundMlaBody'], page: ['notFoundPage', 'notFoundPageBody'] }[kind] || ['notFoundPage', 'notFoundPageBody'];
  show(`${head('')}<div class="empty big"><div class="big-ic warn">${icon('search')}</div><h3>${t(k[0])}</h3><p>${t(k[1])}</p>
    <div class="row-btns"><a class="btn btn-ghost" href="/wards" data-link>${t('browseWards')}</a><a class="btn btn-primary" href="/" data-link>${t('openMap')}</a></div></div>`, { title: `${t(k[0])} · CIVIQ` });
}

// keep the map live
setInterval(async () => { if (document.visibilityState !== 'visible') return; try { setReports(await api('/api/reports')); } catch { /* offline */ } }, 60_000);
boot().catch(e => { console.error(e); toast(`${t('loadError')}`, false); });
