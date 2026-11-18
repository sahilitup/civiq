// Renders the video's text overlays, app-screen slides and end card as 1920x1080 PNGs
// with headless Chrome (same fonts and colours as the site).
// Usage: node video/cards.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'video', 'cards');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const screen = n => pathToFileURL(path.join(ROOT, 'video', 'screens', n)).href;
const logo = fs.readFileSync(path.join(ROOT, 'public', 'logo.svg'), 'utf8');
const logoWhite = logo.replaceAll('#0e3b2e', '#ffffff');

const head = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;font-family:Inter,sans-serif}
.disp{font-family:"Bricolage Grotesque",sans-serif;letter-spacing:-.02em}
</style>`;

// Lower-third caption over footage (transparent background).
const caption = (line, sub = '') => `${head}<style>
body{background:transparent}
.grad{position:absolute;inset:auto 0 0 0;height:520px;background:linear-gradient(to top,rgba(6,20,15,.88),rgba(6,20,15,.55) 45%,rgba(6,20,15,0))}
.t{position:absolute;left:120px;right:160px;bottom:118px;color:#fff}
.t h1{font-size:76px;line-height:1.06;font-weight:800;text-shadow:0 2px 18px rgba(0,0,0,.35)}
.t p{margin-top:22px;font-size:36px;font-weight:500;color:#d5ebe0}
.bar{width:84px;height:8px;border-radius:4px;background:#e5383b;margin-bottom:30px}
</style></head><body><div class="grad"></div><div class="t"><div class="bar"></div><h1 class="disp">${line}</h1>${sub ? `<p>${sub}</p>` : ''}</div></body></html>`;

// App slide: text on the left, phone on the right.
const slide = (step, title, sub, img, crop = 'top') => `${head}<style>
body{background:radial-gradient(1200px 800px at 75% 40%,#1b6b51 0%,#0e3b2e 55%,#082a20 100%);color:#fff}
.l{position:absolute;left:150px;top:0;bottom:0;width:860px;display:flex;flex-direction:column;justify-content:center}
.step{display:inline-flex;align-items:center;gap:14px;font-size:30px;font-weight:600;color:#a8dcc3;margin-bottom:34px}
.step b{display:inline-grid;place-items:center;width:54px;height:54px;border-radius:50%;background:#e5383b;color:#fff;font-size:28px}
h1{font-size:92px;line-height:1.02;font-weight:800}
p{margin-top:34px;font-size:38px;line-height:1.35;color:#d5ebe0;max-width:780px}
.logo{position:absolute;left:150px;top:80px;height:54px}
.phone{position:absolute;right:190px;top:70px;width:440px;height:940px;border-radius:64px;background:#0b0f0d;padding:16px;box-shadow:0 40px 120px rgba(0,0,0,.55),0 0 0 3px #2c3a34 inset}
.phone .scr{width:100%;height:100%;border-radius:50px;overflow:hidden;background:#fff}
.phone img{width:100%;height:100%;object-fit:cover;object-position:${crop}}
.notch{position:absolute;top:30px;left:50%;transform:translateX(-50%);width:120px;height:32px;border-radius:20px;background:#0b0f0d}
</style></head><body>
<div class="logo">${logoWhite.replace('<svg ', '<svg height="54" ')}</div>
<div class="l"><div class="step"><b>${step}</b>How it works</div><h1 class="disp">${title}</h1><p>${sub}</p></div>
<div class="phone"><div class="scr"><img src="${img}"></div><div class="notch"></div></div>
</body></html>`;

const end = (site) => `${head}<style>
body{background:radial-gradient(1200px 800px at 50% 40%,#1b6b51 0%,#0e3b2e 60%,#082a20 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.logo svg{height:150px;width:auto}
h1{margin-top:60px;font-size:84px;font-weight:800;line-height:1.05}
h1 span{color:#ff6b6e}
p{margin-top:40px;font-size:40px;color:#d5ebe0;font-weight:500}
.pill{margin-top:56px;padding:22px 48px;border-radius:999px;background:#fff;color:#0e3b2e;font-size:38px;font-weight:700}
</style></head><body>
<div class="logo">${logoWhite}</div>
<h1 class="disp">See garbage?<br><span>Make it someone's job.</span></h1>
<p>Free · No sign-up · Every ward in Gurugram</p>
<div class="pill">${site}</div>
</body></html>`;

const CARDS = {
  'cap-1': caption("Every day, garbage piles up on Gurugram's roads.", 'Empty plots. Street corners. Footpaths.'),
  'cap-2a': caption('We complain. The complaint disappears.', 'Nobody knows whose job it was, or if anyone came.'),
  'cap-2b': caption('So the same spot stays dirty for weeks.'),
  'app-1': slide(1, 'Take one photo<br>at the spot.', 'Your location and ward are detected automatically.', screen('03-camera.png')),
  'app-2': slide(2, 'We tag who<br>must clean it.', 'Your ward’s sanitary inspector, zone officer, councillor and MLA.', screen('06-who.png'), 'bottom'),
  'app-3': slide(3, 'It goes on a<br>public map.', 'Every open spot, in every ward, for everyone to see.', screen('01-map.png')),
  'app-4': slide(4, 'Neighbours<br>confirm it.', 'The longer it waits, the harder it is to ignore.', screen('07-report.png')),
  'cap-4': caption('It stays open until someone at the spot photographs it clean.'),
  'end': end(process.env.SITE || 'civiq · Gurugram'),
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'civiq-cards-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  for (let k = 0; k < 30; k++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(300); } }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [name, html] of Object.entries(CARDS)) {
    const file = path.join(OUT, `${name}.html`);
    fs.writeFileSync(file, html);
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await sleep(2500);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    fs.unlinkSync(file);
    console.log('saved', name);
  }
} catch (e) { console.error('FAILED', e.message); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} proc.kill(); }
