// Terminal Grid tool: screenshot of a web page / local file, run by Electron (see tg-shot.js). Not meant to be started by hand.
// Options arrive as one JSON string in the TG_SHOT env var: { url, out, width, height, wait, full, js, scale }
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const o = JSON.parse(process.env.TG_SHOT || '{}');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // WebGL (three.js and similar) renders in software
app.commandLine.appendSwitch('ignore-certificate-errors');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('tg-shot: ' + m); app.exit(1); };
setTimeout(() => fail('timeout after ' + (o.timeout || 60) + ' s'), (o.timeout || 60) * 1000).unref();

app.whenReady().then(async () => {
  try {
    const width = o.width || 1280, height = o.height || 800;
    const w = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { backgroundThrottling: false, offscreen: false, zoomFactor: 1 } });
    w.webContents.on('console-message', (_e, level, msg) => { if (level >= 3 && o.console) console.error('page error: ' + String(msg).slice(0, 300)); });
    let loadErr = '';
    w.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3) loadErr = desc + ' (' + code + ') ' + url; });
    await w.loadURL(o.url).catch((e) => { if (!loadErr) loadErr = String(e && e.message || e); });
    if (loadErr) return fail('could not load: ' + loadErr);
    await sleep(o.wait != null ? o.wait : 1500); // scripts, fonts, animations
    if (o.js) {
      try { await w.webContents.executeJavaScript(o.js); } catch (e) { console.error('tg-shot: --js failed: ' + (e && e.message)); }
      await sleep(o.afterJs != null ? o.afterJs : 600);
    }
    if (o.full) {
      const h = await w.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
      w.setContentSize(width, Math.min(Math.max(height, h), 16000));
      await sleep(400);
    }
    let img = await w.webContents.capturePage();
    const want = Math.round(width * (o.scale || 1)); // the screen's DPI scaling makes the capture bigger than the window: bring it back to the size that was asked for
    if (img.getSize().width !== want) img = img.resize({ width: want });
    const png = img.toPNG();
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, png);
    const s = img.getSize();
    console.log('saved ' + path.resolve(o.out) + ' (' + s.width + 'x' + s.height + ', ' + png.length + ' bytes)');
    app.exit(0);
  } catch (e) { fail(String(e && e.stack || e)); }
});
