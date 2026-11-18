// Camera, reporting, cleanup verification, "not garbage" disputes, share sheet, photo viewer.
import { $, esc, api, t, S, icon, toast, openModal, deviceId, store, isTouch, inAppBrowser, mergeReport, sevLabel, wasteLabel, probLabel,
  fmtDist, haversine, stampPhoto, waShare, daysSince } from './core.js';

// ---------- location: keeps sharpening in the background ----------
export function startLocator(onUpdate) {
  let best = null, err = null, wardInfo = null, lastLookup = null, started = Date.now(), watch = null;
  const emit = () => onUpdate?.({ best, err, wardInfo, locked: !!best && (best.accuracy <= 25 || (Date.now() - started > 15000 && best.accuracy <= 80)) });
  async function lookup(p) {
    if (lastLookup && haversine(p.lat, p.lng, lastLookup.lat, lastLookup.lng) < 30) return;
    lastLookup = p;
    try { wardInfo = await api(`/api/locate?lat=${p.lat}&lng=${p.lng}`); emit(); } catch { /* offline */ }
  }
  if (!navigator.geolocation) { err = 'unsupported'; setTimeout(emit); return { stop() {}, get: () => ({ best, err, wardInfo }) }; }
  watch = navigator.geolocation.watchPosition(pos => {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() };
    if (!best || p.accuracy <= best.accuracy || Date.now() - best.at > 20000) best = p;
    err = null; emit(); lookup(best);
  }, e => { err = e.code === 1 ? 'denied' : 'unavailable'; emit(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  return { stop() { navigator.geolocation.clearWatch(watch); }, get: () => ({ best, err, wardInfo }) };
}

// ---------- helper sheets ----------
function platform() { const ua = navigator.userAgent; return /iPhone|iPad/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop'; }
export function locationHelp(onRetry) {
  const p = platform(), name = { ios: 'iPhone', android: 'Android', desktop: 'computer' }[p];
  const m = openModal(`<div class="sheet-body center">
    <div class="big-ic warn">${icon('pin')}</div><h2>${t('locNeededTitle')}</h2><p>${t('locNeededBody')}</p>
    <button class="btn btn-primary btn-block" id="lhRetry">${t('locTryAgain')}</button>
    <div class="howto"><b>${t('locHowTo', { p: name })}</b><p>${t(p === 'ios' ? 'locIos' : p === 'android' ? 'locAndroid' : 'locDesktop')}</p><p class="fine">${t('locCantFind')}</p></div>
    <button class="btn btn-ghost btn-block" data-close>${t('close')}</button></div>`, { sheet: true, label: t('locNeededTitle') });
  m.el.querySelector('#lhRetry').onclick = () => { m.close(); onRetry?.(); };
}
export function inAppSheet(app) {
  const m = openModal(`<div class="sheet-body center"><div class="big-ic">${icon('globe')}</div><h2>${t('inappTitle')}</h2><p>${t('inappBody', { app })}</p>
    <button class="btn btn-primary btn-block" id="iaCopy">${icon('copy')}${t('inappCopy')}</button><button class="btn btn-ghost btn-block" data-close>${t('close')}</button></div>`, { sheet: true });
  m.el.querySelector('#iaCopy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast(t('copied')); } catch { prompt('Copy this link', location.href); } };
}
export function qrSheet() {
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body center">
    <h2>${t('reportFromPhone')}</h2><p>${t('scanQR')}</p><div class="qr" id="qrBox"></div><p class="fine">${esc(location.host)}</p>
    <p class="fine">${t('phoneOnlyBody')}</p></div>`, { label: t('reportFromPhone') });
  if (window.QRCode) new QRCode(m.el.querySelector('#qrBox'), { text: location.origin, width: 200, height: 200, colorDark: '#0e3b2e' });
}
function nightSheet() {
  return new Promise(res => {
    const m = openModal(`<div class="sheet-body center"><div class="big-ic">${icon('moon')}</div><h2>${t('nightTitle')}</h2><p>${t('nightBody')}</p>
      <button class="btn btn-primary btn-block" id="nGo">${t('nightContinue')}</button><button class="btn btn-ghost btn-block" id="nWait">${t('nightWait')}</button></div>`, { sheet: true, onClose: () => res(false) });
    m.el.querySelector('#nGo').onclick = () => { m.wrap.remove(); res(true); };
    m.el.querySelector('#nWait').onclick = () => { m.wrap.remove(); res(false); };
  });
}

// ---------- in-app camera ----------
export function openCamera({ locator, title = t('camTitle') } = {}) {
  return new Promise(async resolve => {
    const night = new Date().getHours() >= 19 || new Date().getHours() < 6;
    const ov = document.createElement('div'); ov.className = 'camera';
    ov.innerHTML = `
      <video playsinline muted autoplay></video><img class="cam-preview hidden" alt="">
      <div class="cam-top"><button class="cam-btn" data-x aria-label="${t('close')}">${icon('x')}</button><span class="cam-title">${esc(title)}</span>
        <button class="cam-btn hidden" data-flash aria-label="${t('camFlash')}">${icon('flash')}</button></div>
      <div class="cam-chip" data-loc><span class="spin"></span>${t('camLocating')}</div>
      <div class="cam-guide">${t(night ? 'camGuidanceNight' : 'camGuidance')} · ${t('camZoom')}</div>
      <div class="cam-bottom"><span></span><button class="shutter" data-shoot aria-label="${t('camShutter')}"></button><span></span></div>
      <div class="cam-review hidden"><button class="btn btn-ghost" data-retake>${t('camRetake')}</button><button class="btn btn-primary" data-use>${icon('check')}${t('camUsePhoto')}</button></div>
      <div class="cam-msg hidden"></div>
      <input type="file" accept="image/*" capture="environment" class="sr-only" data-file>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video'), prev = ov.querySelector('.cam-preview');
    let stream = null, shot = null, torch = false;
    const finish = v => { stream?.getTracks().forEach(tr => tr.stop()); clearInterval(locTimer); ov.remove(); resolve(v); };
    ov.querySelector('[data-x]').onclick = () => finish(null);
    const chip = ov.querySelector('[data-loc]');
    const paint = () => {
      const s = locator?.get(); if (!s) { chip.classList.add('hidden'); return; }
      if (s.err === 'denied') chip.innerHTML = `${icon('alert')}${t('locNeededTitle')}`;
      else if (!s.best) chip.innerHTML = `<span class="spin"></span>${t('camLocating')}`;
      else chip.innerHTML = `${icon('pin')}${s.best.accuracy <= 25 ? t('camLocked', { m: Math.round(s.best.accuracy) }) : t('camImproving', { m: Math.round(s.best.accuracy) })}${s.wardInfo?.ward ? ` · ${t('camWard', { w: s.wardInfo.ward })}` : ''}`;
      chip.classList.toggle('locked', !!s.best && s.best.accuracy <= 25);
    };
    const locTimer = setInterval(paint, 700); paint();

    const fileInput = ov.querySelector('[data-file]');
    fileInput.onchange = async () => {
      const f = fileInput.files[0]; if (!f) return;
      if (Date.now() - f.lastModified > 5 * 60_000) { toast(t('camPrimerBody'), false); return; } // gallery photo, not fresh
      const { compressImage } = await import('./common.js');
      shot = await compressImage(f, 1600, 0.85); showReview();
    };
    const fallback = msg => {
      ov.querySelector('.cam-msg').classList.remove('hidden');
      ov.querySelector('.cam-msg').innerHTML = `<div class="big-ic">${icon('camera')}</div><h2>${msg ? t('camBlockedTitle') : t('camTitle')}</h2>${msg ? `<p>${t('camBlockedBody')}</p><button class="btn btn-ghost btn-block" data-retry>${t('camTryAgain')}</button>` : ''}
        <button class="btn btn-primary btn-block" data-phone>${icon('camera')}${t('camUsePhone')}</button>`;
      ov.querySelector('[data-phone]').onclick = () => fileInput.click();
      ov.querySelector('[data-retry]')?.addEventListener('click', () => { ov.querySelector('.cam-msg').classList.add('hidden'); start(); });
    };
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return fallback(false);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
        video.srcObject = stream; await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        try { if (track.getCapabilities?.().zoom) await track.applyConstraints({ advanced: [{ zoom: 1 }] }); } catch { /* fixed zoom */ }
        if (track.getCapabilities?.().torch) {
          const fb = ov.querySelector('[data-flash]'); fb.classList.remove('hidden');
          fb.onclick = async () => { torch = !torch; fb.classList.toggle('on', torch); try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { /* no torch */ } };
        }
      } catch (e) { fallback(e.name === 'NotAllowedError'); }
    }
    function showReview() {
      prev.src = shot; prev.classList.remove('hidden'); video.classList.add('hidden');
      ov.querySelector('.cam-bottom').classList.add('hidden'); ov.querySelector('.cam-review').classList.remove('hidden'); ov.querySelector('.cam-msg').classList.add('hidden');
    }
    ov.querySelector('[data-shoot]').onclick = () => {
      if (!video.videoWidth) return;
      const s = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      const c = document.createElement('canvas'); c.width = Math.round(video.videoWidth * s); c.height = Math.round(video.videoHeight * s);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      shot = c.toDataURL('image/jpeg', 0.85); showReview();
    };
    ov.querySelector('[data-retake]').onclick = () => {
      shot = null; prev.classList.add('hidden'); video.classList.remove('hidden');
      ov.querySelector('.cam-bottom').classList.remove('hidden'); ov.querySelector('.cam-review').classList.add('hidden');
      if (!stream) fallback(false);
    };
    ov.querySelector('[data-use]').onclick = () => finish(shot);

    if (!store.get('civiq_cam_primer')) {
      const p = openModal(`<div class="sheet-body center"><div class="big-ic">${icon('camera')}</div><h2>${t('camPrimerTitle')}</h2><p>${t('camPrimerBody')}</p><p class="fine">${t('camPrimerNext')}</p>
        <button class="btn btn-primary btn-block" id="cpGo">${t('continue')}</button><button class="btn btn-ghost btn-block" id="cpNo">${t('camNotNow')}</button></div>`, { sheet: true, onClose: () => finish(null) });
      p.el.querySelector('#cpGo').onclick = () => { store.set('civiq_cam_primer', '1'); p.wrap.remove(); start(); };
      p.el.querySelector('#cpNo').onclick = () => { p.wrap.remove(); finish(null); };
    } else start();
  });
}

// ---------- report flow ----------
export async function startReport() {
  const app = inAppBrowser(); if (app) return inAppSheet(app);
  if (!isTouch()) return qrSheet();
  const h = new Date().getHours();
  if ((h >= 19 || h < 6) && !(await nightSheet())) return;
  const locator = startLocator(null);
  const photo = await openCamera({ locator });
  if (!photo) { locator.stop(); return; }
  reportSteps(photo, locator);
}

function reportSteps(photo, locator) {
  const f = { photo, problem: null, severity: null, waste: null, landmark: '' };
  const steps = () => ['problem', 'severity', ...(f.problem === 'fallen_tree' ? [] : ['waste']), 'landmark', 'summary'];
  let i = 0;
  const m = openModal(`<header class="flow-head"><button class="x" data-back aria-label="${t('back')}">${icon('back')}</button>
      <div class="flow-title"><h2>${t('flowTitle')}</h2><p class="step-k" data-k></p><div class="progress"><i data-bar></i></div></div>
      <button class="x" data-close aria-label="${t('close')}">${icon('x')}</button></header>
    <div class="flow-body" data-body></div>
    <footer class="flow-foot"><p class="hint center" data-hint></p><div class="err-msg" role="alert" data-err></div><button class="btn btn-primary btn-block" data-next>${t('next')}</button></footer>`,
    { sheet: true, cls: 'flow', label: t('flowTitle'), onClose: () => locator.stop() });
  const $m = s => m.el.querySelector(s);
  const options = (key, list, labelFn, descFn, iconFn) => `<div class="opts" data-opts="${key}">${list.map(v => `
    <button type="button" class="opt ${f[key] === v ? 'on' : ''}" data-v="${esc(v)}">${iconFn ? iconFn(v) : ''}<span><b>${esc(labelFn(v))}</b>${descFn ? `<small>${esc(descFn(v))}</small>` : ''}</span></button>`).join('')}</div>`;
  const whoHtml = w => {
    if (!w) return `<div class="who"><div class="skeleton"></div></div>`;
    const row = (k, v, cls = '') => v ? `<div class="who-row ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
    if (!w.ward) return `<div class="who"><div class="ward-line"><span class="ward-no">–</span><span><b>${t('outsideMcg')}</b><small>${t('outsideCard')}</small></span></div>${row(t('mla'), w.mla && `${w.mla.name} (${w.mla.seat})`)}</div>`;
    return `<div class="who"><div class="ward-line"><span class="ward-no">${esc(w.ward)}</span><span><b>${t('kickerWard')} ${esc(w.ward)}</b><small>${esc(w.zone)}${w.seat ? ` · ${esc(w.seat)}` : ''}</small></span></div>
      ${row(t('responsible'), w.sanitaryInspector && `${w.sanitaryInspector.name} · ${t('ssi')}`, 'lead')}${row(t('zoneOfficer'), w.jointCommissioner?.name)}${row(t('councillor'), w.councillor?.name)}${row(t('mla'), w.mla?.name)}</div>`;
  };
  function render() {
    const st = steps(), key = st[i], total = st.length;
    $m('[data-k]').textContent = key === 'summary' ? t('lastStep') : t('stepOf', { n: i + 1, total });
    $m('[data-bar]').style.width = `${(i + 1) / total * 100}%`;
    $m('[data-back]').style.visibility = i ? 'visible' : 'hidden';
    $m('[data-err]').textContent = '';
    const body = $m('[data-body]');
    if (key === 'problem') body.innerHTML = `<h3>${t('stepProblemTitle')}</h3><p class="muted">${t('stepProblemHelp')}</p>${options('problem', S.config.problems, probLabel, null,
      v => v === 'fallen_tree' ? `<span class="opt-ic">${icon('tree')}</span>` : v === 'garbage_burning' ? `<span class="opt-ic red">${icon('fire')}</span>` : '')}`;
    if (key === 'severity') body.innerHTML = `<h3>${t('stepSeverityTitle')}</h3><p class="muted">${t('stepSeverityHelp')}</p>${options('severity', S.config.severities, sevLabel,
      v => t(`${f.problem === 'fallen_tree' ? 'sevTree' : 'sevDesc'}_${v}`), v => `<i class="sev-dot sev-${v}"></i>`)}`;
    if (key === 'waste') body.innerHTML = `<h3>${t('stepWasteTitle')}</h3><p class="muted">${t('stepWasteHelp')}</p>${options('waste', S.config.wasteTypes, wasteLabel, v => t(`wasteDesc_${v}`))}`;
    if (key === 'landmark') body.innerHTML = `<h3>${t('stepLandmarkTitle')}</h3><p class="muted">${t('stepLandmarkHelp')}</p>
      <input class="input" id="lm" maxlength="140" placeholder="${esc(t('landmarkPh'))}" value="${esc(f.landmark)}" autocomplete="off" autofocus>`;
    if (key === 'summary') {
      const s = locator.get();
      const row = (k, v, step) => `<div class="sum-row"><span>${esc(k)}</span><b>${esc(v)}</b><button type="button" class="link" data-edit="${step}">${t('sumEdit')}</button></div>`;
      body.innerHTML = `<h3>${t('stepSummaryTitle')}</h3>
        <div class="sum-photo" style="background-image:url('${f.photo}')"></div>
        <div class="box2">${row(t('problem'), probLabel(f.problem), 'problem')}${row(t('severity'), sevLabel(f.severity), 'severity')}
          ${f.problem === 'fallen_tree' ? '' : row(t('wasteType'), wasteLabel(f.waste), 'waste')}${row(t('stepLandmarkTitle'), f.landmark || t('sumLandmarkEmpty'), 'landmark')}</div>
        <div data-who>${whoHtml(s.wardInfo)}</div><p class="fine center">${icon('shield')} ${t('anonymous')}</p>`;
      body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { i = steps().indexOf(b.dataset.edit); render(); });
    }
    body.querySelector('[data-opts]')?.addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return;
      f[b.parentElement.dataset.opts] = b.dataset.v;
      b.parentElement.querySelectorAll('.opt').forEach(x => x.classList.toggle('on', x === b));
      if (f.problem === 'fallen_tree') f.waste = 'garden';
      update(); setTimeout(() => { if (steps()[i] !== 'summary') { i++; render(); } }, 180);
    });
    body.querySelector('#lm')?.addEventListener('input', e => { f.landmark = e.target.value; update(); });
    body.scrollTop = 0; update();
  }
  function update() {
    const key = steps()[i], need = { problem: f.problem, severity: f.severity, waste: f.waste }[key];
    const ok = key === 'landmark' || key === 'summary' || !!need;
    $m('[data-next]').disabled = !ok;
    $m('[data-hint]').textContent = ok ? '' : t('pickFirst');
    $m('[data-next]').textContent = key === 'summary' ? t('submitReport') : key === 'landmark' && !f.landmark.trim() ? t('skip') : t('next');
  }
  const whoTimer = setInterval(() => { const w = m.el.querySelector('[data-who]'); if (w && locator.get().wardInfo && !w.dataset.done) { w.innerHTML = whoHtml(locator.get().wardInfo); w.dataset.done = 1; } }, 800);
  $m('[data-back]').onclick = () => { if (i) { i--; render(); } };
  $m('[data-next]').onclick = async () => {
    if (steps()[i] !== 'summary') { i++; render(); return; }
    const btn = $m('[data-next]'), err = $m('[data-err]');
    let s = locator.get();
    if (s.err === 'denied') { locationHelp(); return; }
    btn.disabled = true; btn.textContent = t('camLocating');
    for (let k = 0; k < 20 && !s.best; k++) { await new Promise(r => setTimeout(r, 500)); s = locator.get(); }
    if (!s.best) { btn.disabled = false; btn.textContent = t('submitReport'); locationHelp(); return; }
    btn.textContent = t('submitting');
    try {
      const out = await api('/api/reports', { method: 'POST', body: { lat: s.best.lat, lng: s.best.lng, photo: f.photo, severity: f.severity, wasteType: f.waste || 'mixed',
        complaintType: f.problem, landmark: f.landmark.trim(), device: deviceId() } });
      const r = out.duplicate ? out.report : out;
      mergeReport(r); clearInterval(whoTimer); locator.stop();
      doneScreen(r, out.duplicate, s.wardInfo);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = t('submitReport'); }
  };
  function doneScreen(r, dup, w) {
    m.el.querySelector('.flow-head [data-k]').textContent = ''; $m('[data-bar]').style.width = '100%'; $m('[data-back]').style.visibility = 'hidden';
    $m('[data-body]').innerHTML = `<div class="done-step"><div class="done-badge">${icon('check')}</div>
      <h3>${dup ? t('dupTitle') : t('doneTitle')}</h3><p class="muted">${dup ? t('dupBody') : t('doneBody', { w: r.wardNo ? ` · ${t('kickerWard')} ${r.wardNo}` : '' })}</p>
      ${whoHtml(w)}<p class="fine">${t('shareToPressure')}</p>${shareButtons(r)}</div>`;
    const foot = m.el.querySelector('.flow-foot'); foot.innerHTML = `<button class="btn btn-primary btn-block" data-view>${t('viewOnMap')}</button>`;
    foot.querySelector('[data-view]').onclick = () => { m.close(); window.dispatchEvent(new CustomEvent('civiq:open', { detail: `/report/${r.id}` })); };
    bindShare(m.el, r);
  }
  render();
}

// ---------- share ----------
const shareText = r => `Garbage at ${r.landmark || r.locality}${r.wardNo ? ` (Ward ${r.wardNo})` : ''}, Gurugram — open ${daysSince(r.createdAt)} days. Seen it too? Confirm it on CIVIQ so MCG can't ignore it:`;
export const shareButtons = r => `<div class="share-row">
  <a class="sh wa" target="_blank" rel="noopener" href="${esc(waShare(`${shareText(r)} ${location.origin}/report/${r.id}`))}">${icon('whatsapp')}<span>WhatsApp</span></a>
  <a class="sh tg" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(`${location.origin}/report/${r.id}`)}&text=${encodeURIComponent(shareText(r))}">${icon('telegram')}<span>Telegram</span></a>
  <a class="sh xx" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(`${shareText(r)} @${S.config.officials.x_handle} ${location.origin}/report/${r.id}`)}">${icon('xlogo')}<span>X</span></a>
  <button class="sh cp" type="button" data-copy>${icon('link')}<span>${t('copyLink')}</span></button></div>`;
export function bindShare(root, r) {
  root.querySelector('[data-copy]')?.addEventListener('click', async () => {
    const url = `${location.origin}/report/${r.id}`;
    try { await navigator.clipboard.writeText(url); toast(t('copied')); } catch { prompt('Copy this link', url); }
  });
}
export function shareSheet(r) {
  const m = openModal(`<button class="x corner" data-close aria-label="${t('close')}">${icon('x')}</button><div class="sheet-body"><h2>${t('share')}</h2><p class="muted">${t('shareToPressure')}</p>${shareButtons(r)}
    ${navigator.share ? `<button class="btn btn-ghost btn-block" data-native>${icon('share')}More options</button>` : ''}</div>`, { sheet: true });
  bindShare(m.el, r);
  m.el.querySelector('[data-native]')?.addEventListener('click', () => navigator.share({ title: 'CIVIQ', text: shareText(r), url: `${location.origin}/report/${r.id}` }).catch(() => {}));
}

// ---------- photo viewer ----------
export function lightbox(photos, start = 0) {
  let i = start;
  const m = openModal(`<button class="x corner light" data-close aria-label="${t('close')}">${icon('x')}</button><img alt="">
    ${photos.length > 1 ? `<button class="lb-nav l" data-p aria-label="Previous photo">${icon('back')}</button><button class="lb-nav r" data-n aria-label="Next photo">${icon('next')}</button>` : ''}<p class="lb-cap"></p>`, { cls: 'lightbox' });
  const show = () => { m.el.querySelector('img').src = photos[i].src; m.el.querySelector('.lb-cap').textContent = photos[i].cap || ''; };
  m.el.querySelector('[data-p]')?.addEventListener('click', () => { i = (i + photos.length - 1) % photos.length; show(); });
  m.el.querySelector('[data-n]')?.addEventListener('click', () => { i = (i + 1) % photos.length; show(); });
  show();
}

// ---------- verify cleanup / not garbage ----------
export function spotFlow(r, kind) {
  const isDispute = kind === 'dispute', R = S.config.verifyRadius, SOFT = S.config.verifySoftRadius;
  const f = { photo: null, reason: null, note: '', loc: null, dist: null };
  let locator = null;
  const m = openModal(`<header class="flow-head"><span></span><div class="flow-title"><h2>${t(isDispute ? 'disputeTitle' : 'verifyTitle')}</h2></div>
      <button class="x" data-close aria-label="${t('close')}">${icon('x')}</button></header><div class="flow-body" data-body></div>
      <footer class="flow-foot"><div class="err-msg" role="alert" data-err></div><div data-foot></div></footer>`,
    { sheet: true, cls: 'flow', onClose: () => locator?.stop() });
  const body = m.el.querySelector('[data-body]'), foot = m.el.querySelector('[data-foot]'), errEl = m.el.querySelector('[data-err]');
  const rows = `<ol class="rows"><li>${icon('pin')}${t('rowStand')}</li><li>${icon('camera')}${t(isDispute ? 'disputeRowPhoto' : 'rowPhoto')}</li><li>${icon(isDispute ? 'flag' : 'check')}${t(isDispute ? 'disputeRowRemove' : 'rowConfirm')}</li></ol>`;
  // 1: are you at the spot?
  body.innerHTML = `${rows}<div class="box2 center"><h3>${t('atSpotTitle')}</h3><p class="muted">${t('atSpotBody')}</p></div>`;
  foot.innerHTML = `<div class="row-btns"><button class="btn btn-ghost" data-close>${t('atSpotLater')}</button><button class="btn btn-primary" data-yes>${t('atSpotYes')}</button></div>`;
  foot.querySelector('[data-yes]').onclick = checkLocation;

  function checkLocation() {
    locator?.stop();
    body.innerHTML = `${rows}<div class="loc-card" data-lc><span class="spin"></span><b>${t('gettingLocation')}</b>
      <div class="tips"><b>${t('tipsTitle')}</b><span>${t('tipSky')}</span><span>${t('tipGps')}</span><span>${t('tipWait')}</span></div></div><div data-rest></div>`;
    foot.innerHTML = '';
    let shown = false;
    locator = startLocator(s => {
      const lc = body.querySelector('[data-lc]'); if (!lc) return;
      if (s.err === 'denied') { lc.className = 'loc-card bad'; lc.innerHTML = `${icon('alert')}<b>${t('locNeededTitle')}</b>`; foot.innerHTML = `<button class="btn btn-primary btn-block" data-help>${t('locTryAgain')}</button>`; foot.querySelector('[data-help]').onclick = () => locationHelp(checkLocation); return; }
      if (!s.best) return;
      f.loc = s.best; f.dist = haversine(s.best.lat, s.best.lng, r.lat, r.lng);
      const d = fmtDist(f.dist);
      if (f.dist <= R) { lc.className = 'loc-card ok'; lc.innerHTML = `${icon('check')}<span><b>${t('verifiedLoc')}</b><small>${t('youreFrom', { d })}</small></span>`; }
      else if (f.dist <= SOFT) { lc.className = 'loc-card warn'; lc.innerHTML = `${icon('alert')}<span><b>${t('partialTitle')}</b><small>${t('partialBody', { d })}</small></span>`; }
      else { lc.className = 'loc-card bad'; lc.innerHTML = `${icon('alert')}<span><b>${t('farTitle')}</b><small>${t('farBody', { d })}</small></span><button class="btn btn-ghost" data-retry>${t('retryGps')}</button>`;
        lc.querySelector('[data-retry]').onclick = checkLocation; foot.innerHTML = ''; shown = false; return; }
      if (!shown) { shown = true; photoStep(); }
    });
  }
  function photoStep() {
    const rest = body.querySelector('[data-rest]');
    rest.innerHTML = `<button type="button" class="shot" data-shot>${f.photo ? `<img src="${f.photo}" alt="">` : `<span class="shot-empty">${icon('camera', 'xl')}<b>${t(isDispute ? 'disputePhotoTitle' : 'takeVerifyPhoto')}</b><small>${t(isDispute ? 'disputePhotoSub' : 'takeVerifyPhotoSub')}</small></span>`}</button>
      ${isDispute ? `<h4 class="mt">${t('reasonTitle')}</h4><div class="chips" data-reasons>${S.config.disputeReasons.map(x => `<button type="button" data-v="${x}" class="${f.reason === x ? 'on' : ''}">${t(`reason_${x}`)}</button>`).join('')}</div>
        <input class="input mt ${f.reason === 'other' ? '' : 'hidden'}" data-note maxlength="200" placeholder="${esc(t('otherPh'))}" value="${esc(f.note)}">
        <button type="button" class="link mt" data-instead>${t('alreadyCleaned')}</button>` : ''}`;
    rest.querySelector('[data-shot]').onclick = async () => {
      const raw = await openCamera({ locator, title: t(isDispute ? 'disputePhotoTitle' : 'takeVerifyPhoto') }); if (!raw) return;
      f.photo = await stampPhoto(raw, { wardNo: r.wardNo, lat: f.loc.lat, lng: f.loc.lng }); photoStep();
    };
    rest.querySelector('[data-reasons]')?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; f.reason = b.dataset.v; photoStep(); });
    rest.querySelector('[data-note]')?.addEventListener('input', e => { f.note = e.target.value; });
    rest.querySelector('[data-instead]')?.addEventListener('click', () => { m.close(); spotFlow(r, 'resolve'); });
    const ready = f.photo && (!isDispute || f.reason);
    foot.innerHTML = `<button class="btn ${isDispute ? 'btn-primary' : 'btn-green'} btn-block" data-submit ${ready ? '' : 'disabled'}>${t('submitReview')}</button>`;
    foot.querySelector('[data-submit]').onclick = submit;
  }
  async function submit() {
    const btn = foot.querySelector('[data-submit]'); btn.disabled = true; btn.textContent = t('submitting'); errEl.textContent = '';
    try {
      const u = await api(`/api/reports/${r.id}/${isDispute ? 'dispute' : 'resolve'}`, { method: 'POST', body: { lat: f.loc.lat, lng: f.loc.lng, photo: f.photo, reason: f.reason, note: f.note, device: deviceId() } });
      mergeReport(u); locator?.stop();
      body.innerHTML = `<div class="done-step"><div class="done-badge">${icon('check')}</div><h3>${t(isDispute ? 'disputeDoneTitle' : 'verifyDoneTitle')}</h3>
        <p class="muted">${t(isDispute ? 'disputeDoneBody' : 'verifyDoneBody')}</p><p class="fine">${t(isDispute ? 'disputeDoneNote' : 'verifyDoneNote')}</p></div>`;
      foot.innerHTML = `<button class="btn btn-primary btn-block" data-close>${t('done')}</button>`;
    } catch (e) { errEl.textContent = e.message; btn.disabled = false; btn.textContent = t('submitReview'); }
  }
}
