'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { needsFfmpeg } = require('./helpers/env');
const { createFixture, makeSourceMp3 } = require('../tools/make-fixture');
const { buildCatalog, sha256File } = require('../electron/lib/catalog');
const { convertToOgg } = require('../electron/lib/audio');
const {
  vaultForClient, slugForClient, loadProfile, applySound, resetSound, reapplyDrifted, writeAtomic,
} = require('../electron/lib/profile');

/**
 * Pelny cykl zycia podmianki na syntetycznym kliencie:
 * podmiana -> wyciszenie -> reset -> drift po patchu launchera -> ponowne wgranie
 * -> obcy plik -> reset z recznej kopii ___.
 *
 * Wymaga ffmpega (konwersja i generowanie ciszy). Bez niego caly plik sie pomija.
 */

let gate = {};
let fixture;
let vaultRoot;
let vault;

async function catalogNow(profile) {
  return buildCatalog({
    soundsDir: fixture.soundsDir,
    clientExe: null,
    profile,
    cacheFile: null,
  });
}

const byId = (cat, id) => cat.entries.find((e) => e.soundId === id);

test.before(async () => {
  gate = await needsFfmpeg();
  if (gate.skip) return;
  fixture = await createFixture();
  vaultRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'tibia-vault-'));
  vault = vaultForClient(vaultRoot, fixture.root);
});

test.after(async () => {
  if (fixture) await fixture.cleanup();
  if (vaultRoot) await fsp.rm(vaultRoot, { recursive: true, force: true });
});

test('vault jest osobny dla kazdej instalacji klienta', () => {
  // Sciezki skladamy przez path.join - na Linuksie backslash nie jest separatorem,
  // wiec zapisane na sztywno "C:\..." dawalyby tam inny slug niz na Windows.
  const tibia = path.join(os.homedir(), 'AppData', 'Local', 'Tibia');
  const other = path.join(os.tmpdir(), 'projekt', 'testclient');

  const a = slugForClient(tibia);
  assert.notEqual(a, slugForClient(other));
  assert.match(a, /^[a-z0-9-]+-[0-9a-f]{10}$/i);
  assert.ok(a.startsWith('tibia-'), `slug ma zaczynac sie od nazwy katalogu, jest ${a}`);

  // ta sama sciezka innym zapisem = ten sam vault
  assert.equal(a, slugForClient(tibia.toUpperCase()));
  // stabilny miedzy wywolaniami
  assert.equal(a, slugForClient(tibia));
});

test('katalog widzi same oryginaly i poprawnie nazywa akcje', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const cat = await catalogNow(profile);

  assert.equal(cat.entries.length, 3);
  assert.ok(cat.entries.every((e) => e.status === 'original'));
  assert.ok(cat.entries.every((e) => e.actualHash === e.expectedHash));

  assert.ok(byId(cat, 1).events.includes('SpellHaste'));
  assert.ok(byId(cat, 2).events.includes('raid_announcement #2776'));
  assert.ok(byId(cat, 3).categories.includes('MUSIC'));

  // parametry audio prosto z naglowkow ogg, bez ffprobe
  assert.equal(byId(cat, 3).sampleRate, 48000);
  assert.equal(byId(cat, 3).channels, 2);
  assert.ok(byId(cat, 3).durationSec > 1.0 && byId(cat, 3).durationSec < 1.5);
});

test('podmiana mp3 -> ogg: backup oryginalu, konwersja, status replaced', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const before = byId(await catalogNow(profile), 1);
  const src = await makeSourceMp3(path.join(vaultRoot, 'zrodlo.mp3'));

  const rec = await applySound({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entryInfo: { soundId: 1, file: before.file },
    srcPath: src,
    mode: 'replace',
  });

  assert.equal(rec.mode, 'replace');
  assert.equal(rec.sourceName, 'zrodlo.mp3');
  assert.notEqual(rec.appliedHash, before.expectedHash);
  assert.equal(await sha256File(path.join(vault.originalsDir, before.file)), before.expectedHash);

  const after = byId(await catalogNow(profile), 1);
  assert.equal(after.status, 'replaced');
  assert.equal(after.actualHash, rec.appliedHash);
  assert.equal(after.sampleRate, before.sampleRate, 'parametry maja zostac jak w oryginale');
  assert.equal(after.channels, before.channels);
});

test('powtorna podmiana nie nadpisuje kopii oryginalu', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await catalogNow(profile), 1);
  const backup = path.join(vault.originalsDir, entry.file);
  const hashBefore = await sha256File(backup);

  const src = await makeSourceMp3(path.join(vaultRoot, 'drugie.mp3'), { freq: 1200 });
  await applySound({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entryInfo: { soundId: 1, file: entry.file },
    srcPath: src,
    mode: 'replace',
  });

  assert.equal(await sha256File(backup), hashBefore, 'kopia oryginalu musi przetrwac');
  assert.equal(hashBefore, entry.expectedHash);
});

test('wyciszenie podmienia na cisze o parametrach oryginalu', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const before = byId(await catalogNow(profile), 3);

  const rec = await applySound({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entryInfo: { soundId: 3, file: before.file },
    mode: 'mute',
  });

  assert.equal(rec.mode, 'mute');
  assert.equal(rec.sourceName, '(cisza)');

  const after = byId(await catalogNow(profile), 3);
  assert.equal(after.status, 'replaced');
  assert.equal(after.sampleRate, 48000);
  assert.equal(after.channels, 2);
  assert.ok(after.durationSec < 0.2, `cisza ma byc krotka, jest ${after.durationSec}`);
  assert.ok(after.size < before.size);
});

test('reset przywraca oryginal i czysci wpis w profilu', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await catalogNow(profile), 1);
  assert.equal(entry.status, 'replaced');

  await resetSound({
    soundsDir: fixture.soundsDir, vault, profile, fileName: entry.file, soundId: 1,
  });

  const after = byId(await catalogNow(profile), 1);
  assert.equal(after.status, 'original');
  assert.equal(after.actualHash, after.expectedHash);
  assert.equal(profile.entries['1'], undefined);
});

test('drift po patchu launchera + zastosuj ponownie', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await catalogNow(profile), 3);
  assert.equal(entry.status, 'replaced');

  // symulacja launchera: wgrywa z powrotem oryginalny plik
  await writeAtomic(
    path.join(fixture.soundsDir, entry.file),
    path.join(vault.originalsDir, entry.file)
  );
  assert.equal(byId(await catalogNow(profile), 3).status, 'drifted');

  const results = await reapplyDrifted({
    soundsDir: fixture.soundsDir,
    vault,
    profile,
    entries: (await catalogNow(profile)).entries,
  });
  assert.deepEqual(results, [{ soundId: 3, ok: true }]);
  assert.equal(byId(await catalogNow(profile), 3).status, 'replaced');
});

test('reapply zglasza brak pliku w library zamiast cicho pomijac', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await catalogNow(profile), 3);
  const rec = profile.entries['3'];
  const libPath = path.join(vault.dir, rec.libraryFile);
  const backup = await fsp.readFile(libPath);

  await writeAtomic(
    path.join(fixture.soundsDir, entry.file),
    path.join(vault.originalsDir, entry.file)
  );
  await fsp.rm(libPath);
  try {
    const results = await reapplyDrifted({
      soundsDir: fixture.soundsDir,
      vault,
      profile,
      entries: (await catalogNow(profile)).entries,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.match(results[0].error, /library/);
  } finally {
    await fsp.writeFile(libPath, backup);
    await reapplyDrifted({
      soundsDir: fixture.soundsDir,
      vault,
      profile,
      entries: (await catalogNow(profile)).entries,
    });
  }
});

test('obcy plik (podmieniony poza aplikacja) dostaje status foreign', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await catalogNow(profile), 2);
  assert.equal(entry.status, 'original');

  const src = await makeSourceMp3(path.join(vaultRoot, 'obcy.mp3'), { freq: 300 });
  const tmpOgg = path.join(vaultRoot, 'obcy.ogg');
  await convertToOgg(src, tmpOgg, {});
  await writeAtomic(path.join(fixture.soundsDir, entry.file), tmpOgg);

  assert.equal(byId(await catalogNow(profile), 2).status, 'foreign');

  // reset bez zadnej kopii musi jasno powiedziec co zrobic
  await assert.rejects(
    resetSound({ soundsDir: fixture.soundsDir, vault, profile, fileName: entry.file, soundId: 2 }),
    /launcher/i
  );
});

test('reczny backup ___sound-<hash>.ogg jest uznawany za oryginal', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  // Uklad spotkany w prawdziwej instalacji: oryginal przemianowany na ___sound-...,
  // a pod wlasciwa nazwa lezy podmianka zrobiona recznie, poza aplikacja.
  const profile = await loadProfile(vault, fixture.root);
  const entry = byId(await catalogNow(profile), 1);
  assert.equal(entry.status, 'original');

  const live = path.join(fixture.soundsDir, entry.file);
  const manual = path.join(fixture.soundsDir, `___${entry.file}`);
  await fsp.copyFile(live, manual);

  const foreign = path.join(vaultRoot, 'reczna-podmianka.ogg');
  await convertToOgg(await makeSourceMp3(path.join(vaultRoot, 'reczna.mp3'), { freq: 500 }), foreign, {});
  await writeAtomic(live, foreign);
  await fsp.rm(path.join(vault.originalsDir, entry.file), { force: true });

  assert.equal(byId(await catalogNow(profile), 1).status, 'foreign');

  await resetSound({
    soundsDir: fixture.soundsDir, vault, profile, fileName: entry.file, soundId: 1,
  });

  const after = byId(await catalogNow(profile), 1);
  assert.equal(after.status, 'original');
  assert.equal(after.actualHash, after.expectedHash);

  await fsp.rm(manual, { force: true });
});

test('podmiana odmawia dzialania gdy nazwa pliku nie jest sound-<sha256>.ogg', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const profile = await loadProfile(vault, fixture.root);
  await assert.rejects(
    applySound({
      soundsDir: fixture.soundsDir,
      vault,
      profile,
      entryInfo: { soundId: 99, file: '../../evil.ogg' },
      srcPath: path.join(vaultRoot, 'zrodlo.mp3'),
      mode: 'replace',
    }),
    /nieoczekiwana nazwa pliku/
  );
});
