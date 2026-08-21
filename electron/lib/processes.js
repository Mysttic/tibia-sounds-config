'use strict';

const { exec } = require('node:child_process');

/**
 * Sprawdza czy klient Tibii jest uruchomiony.
 * Zapis do sounds/ przy dzialajacym kliencie konczy sie EBUSY albo tym,
 * ze klient i tak gra ze starego bufora - blokujemy operacje i mowimy wprost.
 *
 * Wynik jest trojstanowy: klient dziala / nie dziala / NIE WIEM. Trzeci stan jest
 * tu najwazniejszy: wczesniej blad `tasklist` (np. przekroczony limit czasu na
 * obciazonej maszynie) byl cicho traktowany jak "klient nie dziala" i odblokowywal
 * zapis przy uruchomionej grze. Teraz wolajacy decyduje, co z tym zrobic.
 */

const NAMES = ['client.exe', 'Tibia.exe'];
const TIMEOUT_MS = 8000;

function runOnce(cmd, runner) {
  return new Promise((resolve) => {
    runner(cmd, { windowsHide: true, timeout: TIMEOUT_MS }, (err, stdout) => {
      if (err) resolve({ ok: false, error: err.message || String(err) });
      else resolve({ ok: true, out: String(stdout || '') });
    });
  });
}

function parseWindows(out) {
  const lower = out.toLowerCase();
  // tasklist /fo csv opakowuje kazde pole w cudzyslowy, wiec nazwa procesu
  // pasuje tylko jako calosc - "client.exe", nie fragment innej linii.
  return NAMES.filter((n) => lower.includes(`"${n.toLowerCase()}"`));
}

function parseUnix(out) {
  const lower = out.toLowerCase();
  return NAMES.filter((n) => lower.includes(n.toLowerCase().replace(/\.exe$/, '')));
}

/**
 * @returns {Promise<{ok: true, names: string[]} | {ok: false, error: string}>}
 */
async function probeClients({ runner = exec, platform = process.platform, retries = 1 } = {}) {
  const windows = platform === 'win32';
  const cmd = windows ? 'tasklist /fo csv /nh' : 'ps -A -o comm=';

  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await runOnce(cmd, runner);
    if (last.ok) return { ok: true, names: windows ? parseWindows(last.out) : parseUnix(last.out) };
  }
  return { ok: false, error: last.error };
}

/** Lista dzialajacych procesow klienta. Przy bledzie wykrywania rzuca. */
async function runningClients(opts = {}) {
  const probe = await probeClients(opts);
  if (!probe.ok) throw new Error(`nie udalo sie sprawdzic procesow: ${probe.error}`);
  return probe.names;
}

/**
 * Wersja miekka dla UI - przy bledzie wykrywania zwraca false, bo to tylko
 * podpowiedz na ekranie. Do bramkowania zapisu sluzy probeClients.
 */
async function isClientRunning(opts = {}) {
  const probe = await probeClients(opts);
  return probe.ok && probe.names.length > 0;
}

module.exports = { probeClients, isClientRunning, runningClients, NAMES };
