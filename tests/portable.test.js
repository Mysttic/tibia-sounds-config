'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { needsFfmpeg } = require('./helpers/env');
const { createFixture, makeSourceMp3 } = require('../tools/make-fixture');
const { buildCatalog, sha256File } = require('../electron/lib/catalog');
const { vaultForClient, loadProfile, applySound } = require('../electron/lib/profile');
const { buildBundle, applyBundle, validateBundle, FORMAT } = require('../electron/lib/portable');

/**
 * Eksport/import przenosnego profilu. Scenariusz docelowy: po aktualizacji klienta
 * pliki wracaja do oryginalu, a uzytkownik wgrywa profil i podmianki sa z powrotem.
 */

let gate = {};
let fixture;
let vaultRoot;
let vault;

const byId = (cat, id) => cat.entries.find((e) => e.soundId === id);
const katalog = (profile) => buildCatalog({
  soundsDir: fixture.soundsDir, clientExe: null, profile, cacheFile: null,
});

test.before(async () => {
  gate = await needsFfmpeg();
  if (gate.skip) return;
  fixture = await createFixture();
  vaultRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-portable-'));
  vault = vaultForClient(vaultRoot, fixture.root);
});

test.after(async () => {
  if (fixture) await fixture.cleanup();
  if (vaultRoot) await fsp.rm(vaultRoot, { recursive: true, force: true });
});

test('validateBundle odrzuca cudze i uszkodzone pliki', () => {
  assert.throws(() => validateBundle(null), /poprawnym profilem/);
  assert.throws(() => validateBundle({ format: 'cos innego' }), /nie jest profil/);
  assert.throws(() => validateBundle({ format: FORMAT, version: 99, entries: [] }), /nowsza wersja/);
  assert.throws(() => validateBundle({ format: FORMAT, version: 1 }), /listy podmianek/);
  assert.ok(validateBundle({ format: FORMAT, version: 1, entries: [] }));
});

test('eksport pakuje audio razem z opisem', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const before = byId(await katalog(profile), 1);
  const src = await makeSourceMp3(path.join(vaultRoot, 'zrodlo.mp3'));

  await applySound({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entryInfo: { soundId: 1, file: before.file },
    srcPath: src,
    mode: 'replace',
    source: { title: 'testowy dzwiek', providerId: 'openverse', license: 'CC0', author: 'ktos' },
  });

  const { bundle, bytes, skipped } = await buildBundle({
    vault, profile, appVersion: '9.9.9', clientVersion: '0.0.0-fixture',
  });

  assert.equal(bundle.format, FORMAT);
  assert.equal(bundle.appVersion, '9.9.9');
  assert.equal(bundle.entries.length, 1);
  assert.deepEqual(skipped, []);
  assert.ok(bytes > 0);

  const wpis = bundle.entries[0];
  assert.equal(wpis.soundId, 1);
  assert.equal(wpis.sourceName, 'testowy dzwiek');
  assert.equal(wpis.origin.provider, 'openverse');
  assert.ok(wpis.audioBase64.length > 100, 'audio ma byc osadzone w profilu');
  // osadzone bajty to poprawny strumien Ogg
  assert.equal(Buffer.from(wpis.audioBase64, 'base64').subarray(0, 4).toString(), 'OggS');
});

test('import przywraca podmianke po powrocie pliku do oryginalu', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const { bundle } = await buildBundle({ vault, profile });
  const entry = byId(await katalog(profile), 1);
  const podmieniony = entry.actualHash;

  // symulacja aktualizacji klienta: plik wraca do oryginalu, profil znika
  const { writeAtomic } = require('../electron/lib/profile');
  await writeAtomic(
    path.join(fixture.soundsDir, entry.file),
    path.join(vault.originalsDir, entry.file)
  );
  profile.entries = {};
  assert.equal(byId(await katalog(profile), 1).status, 'original');

  const wynik = await applyBundle({
    bundle, soundsDir: fixture.soundsDir, vault, profile,
  });

  assert.equal(wynik.applied.length, 1);
  assert.deepEqual(wynik.skipped, []);

  const po = byId(await katalog(profile), 1);
  assert.equal(po.status, 'replaced');
  assert.equal(po.actualHash, podmieniony, 'ma wrocic dokladnie ten sam plik');
  assert.equal(profile.entries['1'].origin.provider, 'openverse');
});

test('import pomija dzwieki, ktorych nie ma w tej wersji klienta', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const obcyHash = 'b'.repeat(64);
  const bundle = {
    format: FORMAT,
    version: 1,
    entries: [{
      soundId: 999,
      file: `sound-${obcyHash}.ogg`,
      originalHash: obcyHash,
      mode: 'replace',
      sourceName: 'dzwiek z innej wersji',
      audioBase64: Buffer.from('OggS placeholder').toString('base64'),
    }],
  };

  const wynik = await applyBundle({ bundle, soundsDir: fixture.soundsDir, vault, profile });
  assert.equal(wynik.applied.length, 0);
  assert.equal(wynik.skipped.length, 1);
  assert.match(wynik.skipped[0].powod, /nie ma w biezacej wersji klienta/);
});

test('import odrzuca wpis, ktorego audio nie jest poprawnym ogg', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await katalog(profile), 2);
  const bundle = {
    format: FORMAT,
    version: 1,
    entries: [{
      soundId: 2,
      file: entry.file,
      originalHash: entry.expectedHash,
      mode: 'replace',
      sourceName: 'smieci',
      audioBase64: Buffer.alloc(4096, 0x41).toString('base64'),
    }],
  };

  const wynik = await applyBundle({ bundle, soundsDir: fixture.soundsDir, vault, profile });
  assert.equal(wynik.applied.length, 0);
  assert.match(wynik.skipped[0].powod, /nie jest poprawnym ogg/);
  // plik w kliencie ma zostac nietkniety
  assert.equal(byId(await katalog(profile), 2).status, 'original');
});

test('eksport zglasza wpisy bez pliku w vaulcie zamiast je gubic', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  profile.entries['777'] = {
    soundId: 777,
    file: `sound-${'c'.repeat(64)}.ogg`,
    originalHash: 'c'.repeat(64),
    mode: 'replace',
    sourceName: 'wpis bez pliku',
    libraryFile: 'library/nie-ma-takiego.ogg',
    appliedHash: 'x',
  };

  const { bundle, skipped } = await buildBundle({ vault, profile });
  assert.ok(skipped.some((s) => s.soundId === 777 && /brak pliku/.test(s.powod)));
  assert.ok(!bundle.entries.some((e) => e.soundId === 777));
  delete profile.entries['777'];
});
