const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1200, height: 800, show: false });
  await w.loadFile('/tmp/drag.html');
  await new Promise(r => setTimeout(r, 900));
  const out = await w.webContents.executeJavaScript(`(() => {
    const before = { results: window.__h('res'), code: window.__h('code') };
    window.__drag(-100);                       // pointer moves 100px UP
    const afterUp = { results: window.__h('res'), code: window.__h('code') };
    window.__drag(100);                        // and 100px down from there
    const afterDown = { results: window.__h('res'), code: window.__h('code') };
    return { before, afterUp, afterDown };
  })()`);
  console.log(JSON.stringify(out));
  app.quit();
});
