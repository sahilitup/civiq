// Captures phone-size app screens (390x844 @3x) with headless Chrome over the DevTools protocol.
// Usage: node video/shots.mjs http://localhost:5173 video/screens
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = process.argv[3] || 'video/screens';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'civiq-shots-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
  '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error'); return r.result.value; };
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('saved', name);
}
async function go(url) { await send('Page.navigate', { url }); await sleep(6000); }

try {
  for (let k = 0; k < 30; k++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(300); } }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  // Skip intro / primers, quiet the digest banner, set a daytime clock so the night warning does not show.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('civiq_intro','1');localStorage.setItem('civiq_cam_primer','1');localStorage.setItem('civiq_digest_x','1');}catch(e){}
    (()=>{const D=Date; const fixed=new D(); fixed.setHours(11,0,0,0); const off=fixed-D.now(); class FD extends D{constructor(...a){super(...(a.length?a:[D.now()+off]))} static now(){return D.now()+off}} window.Date=FD;})();` });

  const reports = await (await fetch(`${BASE}/api/reports`)).json();
  const ex = reports.filter(r => r.isExample && r.status === 'open').sort((a, b) => b.seenCount - a.seenCount)[0];

  // 1) Map with pins, panel at peek.
  await go(`${BASE}/`); await sleep(4000); await shot('01-map');
  // 2) Panel open with photo cards.
  await evaluate(`document.querySelector('#sheet').dataset.snap='half'; true`); await sleep(1500); await shot('02-list');

  // Location only from here on, so the map shots above stay at city zoom.
  await send('Browser.grantPermissions', { origin: BASE, permissions: ['geolocation'] });
  await send('Emulation.setGeolocationOverride', { latitude: 28.4705, longitude: 77.043, accuracy: 8 });
  // 3) Camera step: feed a real garbage photo as the camera stream.
  await evaluate(`(async()=>{
    const img=new Image(); img.crossOrigin='anonymous'; img.src='${ex.photo}'; await img.decode();
    const c=document.createElement('canvas'); c.width=1080; c.height=1440; const g=c.getContext('2d');
    const draw=()=>{const s=Math.max(c.width/img.width,c.height/img.height); const w=img.width*s,h=img.height*s; g.drawImage(img,(c.width-w)/2,(c.height-h)/2,w,h);};
    draw(); setInterval(draw,100);
    navigator.mediaDevices.getUserMedia=async()=>c.captureStream(10);
    document.querySelector('#reportFab').click(); return true;})()`);
  await sleep(5000); await shot('03-camera');
  await evaluate(`document.querySelector('[data-shoot]').click(); true`); await sleep(800);
  await evaluate(`document.querySelector('[data-use]').click(); true`); await sleep(1500);
  await shot('04-problem');
  await evaluate(`document.querySelector('[data-opts] [data-v="public_place"]').click(); true`); await sleep(900);
  await shot('05-severity');
  await evaluate(`document.querySelector('[data-opts] [data-v="severe"]').click(); true`); await sleep(900);
  await evaluate(`document.querySelector('[data-opts] [data-v="mixed"]').click(); true`); await sleep(900);
  await evaluate(`const l=document.querySelector('#lm'); l.value='Behind Sector 14 market'; l.dispatchEvent(new Event('input')); document.querySelector('[data-next]').click(); true`);
  await sleep(2500);
  await evaluate(`document.querySelector('[data-body]').scrollTop=420; true`); await sleep(600);
  await shot('06-who');

  // 4) A report page: photo, seen count, then who must clean it.
  await go(`${BASE}/report/${ex.id}`); await sleep(2000); await shot('07-report');
  await evaluate(`const v=document.querySelector('#view'); const b=[...v.querySelectorAll('.box2')].find(x=>/KNOW YOUR WARD|Know your ward/i.test(x.innerText)); v.scrollTop=(b?b.offsetTop-70:900); true`);
  await sleep(1000); await shot('08-responsible');
  // 5) Ward page with MLA and councillor.
  await go(`${BASE}/ward/${ex.wardNo}`); await sleep(2000); await shot('09-ward');
} catch (e) { console.error('FAILED', e.message); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} proc.kill(); }
