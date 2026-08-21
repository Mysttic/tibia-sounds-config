'use strict';

/**
 * Narzedzie deweloperskie: robi zrzut ekranu okna aplikacji przez CDP.
 * Dziala bez uprawnien do pulpitu - Electron fotografuje sam siebie.
 *
 * Wymaga aplikacji uruchomionej z `--remote-debugging-port=9222`.
 *
 *   node tools/cdp-screenshot.js docs/img/nazwa.png
 */

const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.CDP_PORT || 9222);

function send(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
}

async function capture(outPath) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('brak otwartej strony - czy aplikacja dziala z --remote-debugging-port?');

  const data = await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 40000);

    ws.addEventListener('open', () => {
      // Bez wlaczonej domeny Page zrzut potrafi nie odpowiedziec, gdy okno nie jest
      // aktywne. captureBeyondViewport wymusza render niezaleznie od widocznosci.
      send(ws, 1, 'Page.enable');
      send(ws, 2, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        optimizeForSpeed: false,
      });
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== 2) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      resolve(msg.result.data);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('blad WebSocket')); });
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  const { size } = fs.statSync(outPath);
  console.log(`zapisano ${outPath} (${Math.round(size / 1024)} kB)`);
}

capture(process.argv[2] || 'screenshot.png').catch((err) => {
  console.error('blad:', err.message);
  process.exit(1);
});
