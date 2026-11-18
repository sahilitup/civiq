// Edits the explainer: Flow clips + caption overlays + app slides + end card.
// If video/voiceover.mp3 exists it is laid over the whole film and the street sound is ducked.
// Usage: node video/build.mjs   (run node video/cards.mjs first)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const V = p => path.join(ROOT, 'video', p);
const FF = process.env.FFMPEG || 'C:/Users/sahil/AppData/Roaming/Python/Python314/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe';
const TMP = V('tmp'); fs.mkdirSync(TMP, { recursive: true });
const OUT_DIR = path.join(ROOT, 'public', 'video'); fs.mkdirSync(OUT_DIR, { recursive: true });
const ff = args => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const FPS = 24, W = 1920, H = 1080;
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];
const fades = d => `fade=t=in:st=0:d=0.35,fade=t=out:st=${(d - 0.35).toFixed(2)}:d=0.35`;
const afades = d => `afade=t=in:st=0:d=0.35,afade=t=out:st=${(d - 0.4).toFixed(2)}:d=0.4`;

// Footage segment with timed caption overlays: caps = [[png, from, to], ...]
function footage(name, clip, dur, caps, gain = 0.7) {
  const inputs = ['-i', V(`clips/${clip}`)];
  caps.forEach(([png]) => inputs.push('-loop', '1', '-t', String(dur), '-i', V(`cards/${png}.png`)));
  // Slow push-in on the footage so stills from Veo never feel static.
  let f = `[0:v]scale=${W * 1.08}:-2,crop=${W}:${H}:'(iw-${W})/2+t*6':'(ih-${H})/2',setsar=1,fps=${FPS}[b0];`;
  caps.forEach(([, a, b], i) => {
    f += `[${i + 1}:v]format=rgba,fade=t=in:st=${a}:d=0.4:alpha=1,fade=t=out:st=${b - 0.4}:d=0.4:alpha=1[c${i}];`;
    f += `[b${i}][c${i}]overlay=0:0:enable='between(t,${a},${b})'[b${i + 1}];`;
  });
  f += `[b${caps.length}]${fades(dur)}[v];[0:a]volume=${gain},${afades(dur)}[a]`;
  ff([...inputs, '-filter_complex', f, '-map', '[v]', '-map', '[a]', '-t', String(dur), ...ENC, path.join(TMP, `${name}.mp4`)]);
}

// Still slide with a gentle zoom and silent audio.
function still(name, png, dur, zoom = 0.035) {
  const n = Math.round(dur * FPS);
  const f = `[0:v]scale=${W * 2}:${H * 2},zoompan=z='1+${zoom}*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=${FPS},setsar=1,${fades(dur)}[v]`;
  ff(['-loop', '1', '-i', V(`cards/${png}.png`), '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', f, '-map', '[v]', '-map', '1:a', '-t', String(dur), ...ENC, path.join(TMP, `${name}.mp4`)]);
}

const SEGS = [];
const seg = (fn, ...a) => { fn(...a); SEGS.push(a[0]); };
seg(footage, 's1', 'c1-heap.mp4', 7, [['cap-1', 0.6, 7]]);
seg(footage, 's2', 'c3-cow.mp4', 7.5, [['cap-2a', 0.3, 3.9], ['cap-2b', 4.1, 7.5]]);
seg(still, 's3', 'app-1', 5.5);
seg(still, 's4', 'app-2', 6);
seg(still, 's5', 'app-3', 4.5);
seg(still, 's6', 'app-4', 4.5);
seg(footage, 's7', 'c7-workers.mp4', 7.9, [['cap-4', 0.5, 7.9]]);
seg(still, 's8', 'end', 5.5, 0.02);

const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, SEGS.map(s => `file '${path.join(TMP, s + '.mp4').replaceAll('\\', '/')}'`).join('\n'));
const joined = path.join(TMP, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

// Voiceover (optional): ducks the street sound under the narration.
const vo = V('voiceover.mp3');
const master = V('civiq-explainer-1080p.mp4');
if (fs.existsSync(vo)) {
  ff(['-i', joined, '-i', vo, '-filter_complex',
    '[0:a]volume=0.35[bg];[1:a]adelay=600|600,volume=1.0[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', master]);
} else fs.copyFileSync(joined, master);

// Web copy (720p, small, starts fast) + poster frame.
ff(['-i', master, '-vf', 'scale=1280:720', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(OUT_DIR, 'civiq-explainer.mp4')]);
ff(['-ss', '2.5', '-i', master, '-frames:v', '1', '-vf', 'scale=1280:720', '-q:v', '3', path.join(OUT_DIR, 'civiq-explainer.jpg')]);
console.log('done', fs.existsSync(vo) ? '(with voiceover)' : '(captions + street sound, no voiceover yet)');
