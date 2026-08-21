'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { needsFfmpeg } = require('./helpers/env');
const { createFixture } = require('../tools/make-fixture');
const { buildCatalog } = require('../electron/lib/catalog');
const { vaultForClient, loadProfile, applyPreset } = require('../electron/lib/profile');
const { normalizePreset, resolvePreset, planChanges } = require('../electron/lib/presets');

/**
 * Wgrywanie zestawu na syntetycznym kliencie. Najwazniejsza teza do udowodnienia:
 * cisza jest generowana RAZ na kombinacje sampleRate/kanaly i wspoldzielona,
 * a nie raz na kazdy dzwiek. Od tego zalezy, czy "wycisz wszystko" trwa sekundy
 * czy minuty.
 *
 * Wymaga ffmpega. Bez niego caly plik sie pomija.
 */

let gate = {};
let fixture;
let vaultRoot;
let vault;

test.before(async () => {
  gate = await needsFfmpeg();
  if (gate.skip) return;
  fixture = await createFixture();
  vaultRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'tibia-preset-vault-'));
  vault = vaultForClient(vaultRoot, fixture.root);
});

test.after(async () => {
  if (fixture) await fixture.cleanup();
  if (vaultRoot) await fsp.rm(vaultRoot, { recursive: true, force: true });
});

async function katalog(profile) {
  return buildCatalog({
    soundsDir: fixture.soundsDir, clientExe: null, profile, cacheFile: null,
  });
}

async function wgraj(profile, preset, opcje = {}) {
  const cat = await katalog(profile);
  const { doZrobienia } = planChanges(resolvePreset(preset, cat.entries), cat.entries);
  const wynik = await applyPreset({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entries: cat.entries,
    changes: doZrobienia,
    ...opcje,
  });
  return { wynik, doZrobienia };
}

const CISZA = normalizePreset({
  name: 'cisza wszedzie',
  rules: [{ match: { all: true }, action: 'mute' }],
});
const ORYGINAL = normalizePreset({
  name: 'wszystko oryginalne',
  rules: [{ match: { all: true }, action: 'original' }],
});

test('cisza powstaje raz na kombinacje parametrow, nie raz na dzwiek', async (t) => {
  if (gate.skip) return t.skip(gate.reason);

  const profile = await loadProfile(vault, fixture.root);
  const przed = await katalog(profile);
  // Ile roznych ciszy jest w ogole potrzebnych - tyle, ile roznych par
  // (sampleRate, kanaly) wystepuje w oryginalach.
  const kombinacje = new Set(przed.entries.map((e) => `${e.sampleRate}-${e.channels}`));

  const postep = [];
  const { wynik, doZrobienia } = await wgraj(profile, CISZA, {
    onProgress: (done, total) => postep.push([done, total]),
  });

  assert.equal(wynik.bledy.length, 0, JSON.stringify(wynik.bledy));
  assert.equal(wynik.zmienione, doZrobienia.length);
  assert.ok(doZrobienia.length >= 3, 'fixture ma co najmniej trzy dzwieki');

  // TO jest sedno: liczba plikow ciszy zalezy od parametrow, a nie od liczby dzwiekow
  const ciszki = (await fsp.readdir(vault.libraryDir)).filter((f) => f.startsWith('silence-'));
  assert.equal(ciszki.length, kombinacje.size,
    `oczekiwano ${kombinacje.size} plikow ciszy (tyle jest kombinacji), jest ${ciszki.length}: ${ciszki}`);
  assert.ok(ciszki.length < doZrobienia.length,
    'plikow ciszy musi byc mniej niz podmienianych dzwiekow');

  // wpisy profilu wskazuja na wspoldzielone pliki, nie na kopie per dzwiek
  const wpisy = Object.values(profile.entries);
  assert.equal(wpisy.length, doZrobienia.length);
  assert.equal(new Set(wpisy.map((w) => w.libraryFile)).size, kombinacje.size);
  assert.ok(wpisy.every((w) => w.mode === 'mute'));

  assert.deepEqual(postep.at(-1), [doZrobienia.length, doZrobienia.length]);

  const cat = await katalog(profile);
  assert.ok(cat.entries.every((e) => e.status === 'replaced'), 'wszystko wyciszone');
});

test('zestaw "wszystko oryginalne" czysci profil i przywraca pliki', async (t) => {
  if (gate.skip) return t.skip(gate.reason);

  const profile = await loadProfile(vault, fixture.root);
  const { wynik } = await wgraj(profile, ORYGINAL);

  assert.equal(wynik.bledy.length, 0, JSON.stringify(wynik.bledy));
  assert.deepEqual(profile.entries, {}, 'profil pusty po przywroceniu');

  const cat = await katalog(profile);
  assert.ok(cat.entries.every((e) => e.status === 'original'));
});

test('ponowne wgranie tego samego zestawu nie ma nic do roboty', async (t) => {
  if (gate.skip) return t.skip(gate.reason);

  const profile = await loadProfile(vault, fixture.root);
  await wgraj(profile, CISZA);

  const cat = await katalog(profile);
  const { doZrobienia, bezZmian } = planChanges(resolvePreset(CISZA, cat.entries), cat.entries);
  assert.deepEqual(doZrobienia, [], 'drugi przebieg nie rusza plikow');
  assert.ok(bezZmian >= 3);

  await wgraj(profile, ORYGINAL); // sprzatanie po tescie
});

test('blad na jednym dzwieku nie przerywa partii', async (t) => {
  if (gate.skip) return t.skip(gate.reason);

  const profile = await loadProfile(vault, fixture.root);
  const cat = await katalog(profile);

  // Podstawiamy nieistniejacy plik jako jeden z celow - reszta ma przejsc.
  const changes = [
    { soundId: 999999, action: 'mute', file: `sound-${'f'.repeat(64)}.ogg` },
    ...planChanges(resolvePreset(CISZA, cat.entries), cat.entries).doZrobienia,
  ];
  const entries = [
    { soundId: 999999, file: `sound-${'f'.repeat(64)}.ogg`, categories: [], status: 'original', profile: null },
    ...cat.entries,
  ];

  const wynik = await applyPreset({
    soundsDir: fixture.soundsDir, vault, profile, entries, changes,
  });

  assert.equal(wynik.bledy.length, 1, 'dokladnie jeden problem');
  assert.equal(wynik.bledy[0].soundId, 999999);
  assert.ok(wynik.zmienione >= 3, 'pozostale dzwieki poszly mimo bledu');

  await wgraj(profile, ORYGINAL);
});

test('shouldContinue przerywa partie i zapisuje to, co juz zrobione', async (t) => {
  if (gate.skip) return t.skip(gate.reason);

  const profile = await loadProfile(vault, fixture.root);
  const cat = await katalog(profile);
  const { doZrobienia } = planChanges(resolvePreset(CISZA, cat.entries), cat.entries);

  // Sprawdzenie odpala sie co 40 pozycji, wiec przy trzech dzwiekach nie zdazy
  // sie wykonac - to potwierdza, ze krotkie partie nie placa za ten mechanizm.
  let pytano = 0;
  const wynik = await applyPreset({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entries: cat.entries,
    changes: doZrobienia,
    shouldContinue: async () => { pytano += 1; return true; },
  });

  assert.equal(pytano, 0, 'przy krotkiej partii nie pytamy wcale');
  assert.equal(wynik.przerwane, false);
  assert.equal(wynik.zmienione, doZrobienia.length);

  await wgraj(profile, ORYGINAL);
});
