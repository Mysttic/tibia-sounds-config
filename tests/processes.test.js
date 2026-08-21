'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { probeClients, isClientRunning, runningClients } = require('../electron/lib/processes');

/**
 * Wykrywanie klienta bramkuje kazdy zapis do plikow gry, wiec liczy sie nie tylko
 * to, co robi po udanym sprawdzeniu, ale przede wszystkim to, co robi po nieudanym.
 */

/** Podstawiany `exec`: oddaje kolejne odpowiedzi z listy i zlicza wywolania. */
function fakeExec(odpowiedzi) {
  const calls = [];
  const runner = (cmd, opts, cb) => {
    calls.push({ cmd, opts });
    const next = odpowiedzi[Math.min(calls.length - 1, odpowiedzi.length - 1)];
    // exec woluje callback asynchronicznie - odwzorowujemy to wiernie
    setImmediate(() => (next.err ? cb(next.err, '') : cb(null, next.out)));
  };
  runner.calls = calls;
  return runner;
}

const TASKLIST_Z_KLIENTEM = [
  '"svchost.exe","1044","Services","0","12 345 K"',
  '"client.exe","8123","Console","1","512 000 K"',
  '"explorer.exe","4200","Console","1","98 000 K"',
].join('\r\n');

const TASKLIST_BEZ_KLIENTA = [
  '"svchost.exe","1044","Services","0","12 345 K"',
  '"explorer.exe","4200","Console","1","98 000 K"',
].join('\r\n');

// --- wykrywanie ------------------------------------------------------------

test('rozpoznaje client.exe w wyjsciu tasklist', async () => {
  const runner = fakeExec([{ out: TASKLIST_Z_KLIENTEM }]);
  const probe = await probeClients({ runner, platform: 'win32' });

  assert.equal(probe.ok, true);
  assert.deepEqual(probe.names, ['client.exe']);
  assert.match(runner.calls[0].cmd, /^tasklist/);
});

test('brak klienta to pusta lista, a nie blad', async () => {
  const probe = await probeClients({ runner: fakeExec([{ out: TASKLIST_BEZ_KLIENTA }]), platform: 'win32' });
  assert.deepEqual(probe, { ok: true, names: [] });
});

test('nazwa procesu musi pasowac w calosci, nie jako fragment', async () => {
  // proces o mylacej nazwie nie moze udawac klienta
  const out = '"nie-client.exe-tak","1","Console","1","1 K"';
  const probe = await probeClients({ runner: fakeExec([{ out }]), platform: 'win32' });
  assert.deepEqual(probe.names, []);
});

test('na systemach unixowych pyta ps i dopasowuje nazwe bez .exe', async () => {
  const runner = fakeExec([{ out: 'systemd\nTibia\nbash\n' }]);
  const probe = await probeClients({ runner, platform: 'linux' });

  assert.equal(probe.ok, true);
  assert.deepEqual(probe.names, ['Tibia.exe']);
  assert.match(runner.calls[0].cmd, /^ps /);
});

// --- zachowanie przy bledzie wykrywania ------------------------------------

test('blad polecenia daje ok:false, a nie ciche "klient nie dziala"', async () => {
  const probe = await probeClients({
    runner: fakeExec([{ err: new Error('Command failed: timeout') }]),
    platform: 'win32',
    retries: 0,
  });

  assert.equal(probe.ok, false);
  assert.match(probe.error, /timeout/);
  assert.equal(probe.names, undefined);
});

test('nieudane sprawdzenie jest powtarzane', async () => {
  const runner = fakeExec([{ err: new Error('chwilowy blad') }, { out: TASKLIST_Z_KLIENTEM }]);
  const probe = await probeClients({ runner, platform: 'win32' });

  assert.equal(runner.calls.length, 2, 'druga proba powinna dojsc do skutku');
  assert.equal(probe.ok, true);
  assert.deepEqual(probe.names, ['client.exe']);
});

test('gdy wszystkie proby zawioda, nie zgadujemy', async () => {
  const runner = fakeExec([{ err: new Error('stale zle') }]);
  const probe = await probeClients({ runner, platform: 'win32', retries: 2 });

  assert.equal(runner.calls.length, 3);
  assert.equal(probe.ok, false);
});

// --- warstwa wygody --------------------------------------------------------

test('isClientRunning jest miekkie - blad wykrywania to false', async () => {
  const runner = fakeExec([{ err: new Error('nie ma tasklist') }]);
  assert.equal(await isClientRunning({ runner, platform: 'win32', retries: 0 }), false);
});

test('runningClients jest twarde - blad wykrywania rzuca', async () => {
  const runner = fakeExec([{ err: new Error('nie ma tasklist') }]);
  await assert.rejects(
    () => runningClients({ runner, platform: 'win32', retries: 0 }),
    /nie udalo sie sprawdzic procesow/
  );
});

test('timeout jest ustawiony, zeby sprawdzenie nie wisialo w nieskonczonosc', async () => {
  const runner = fakeExec([{ out: '' }]);
  await probeClients({ runner, platform: 'win32' });
  assert.ok(runner.calls[0].opts.timeout > 0);
  assert.equal(runner.calls[0].opts.windowsHide, true);
});
