'use strict';

/**
 * Narzedzie deweloperskie: laczy sie z uruchomionym Electronem po CDP
 * (`npx electron . --remote-debugging-port=9222`) i wykonuje wyrazenie
 * w kontekscie renderera. Sluzy do weryfikacji UI bez robienia screenshotow.
 *
 * Uzycie:
 *   node tools/cdp-probe.js "document.querySelectorAll('#tb tr').length"
 *   node tools/cdp-probe.js --file probe.js
 */

const fs = require('node:fs');

const PORT = Number(process.env.CDP_PORT || 9222);

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function evaluate(wsUrl, expression, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP timeout'));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      const r = msg.result;
      if (r.exceptionDetails) {
        return reject(new Error(r.exceptionDetails.exception?.description || 'wyjatek w rendererze'));
      }
      resolve(r.result.value);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('blad polaczenia WebSocket z CDP'));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let expression;
  if (args[0] === '--file') expression = fs.readFileSync(args[1], 'utf8');
  else expression = args.join(' ');
  if (!expression) throw new Error('podaj wyrazenie albo --file <plik.js>');

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`brak targetu typu page (targety: ${targets.map((t) => t.type).join(', ')})`);

  const value = await evaluate(page.webSocketDebuggerUrl, expression);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
}

main().catch((err) => {
  console.error('probe error:', err.message);
  process.exit(1);
});
