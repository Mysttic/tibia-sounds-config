'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { createRawFixture } = require('../tools/make-fixture');
const {
  buildCatalog, buildUsageMap, computeStatus, sha256File, HashCache, FILENAME_HASH,
} = require('../electron/lib/catalog');
const { loadSoundBank } = require('../electron/lib/soundBank');
const { loadSnapshot } = require('../electron/lib/descriptors');

let fixture;

test.before(async () => { fixture = await createRawFixture(); });
test.after(async () => { await fixture.cleanup(); });

// --- statusy (czysta logika, bez plikow) -----------------------------------

test('computeStatus pokrywa wszystkie kombinacje hash x profil', () => {
  const H = 'a'.repeat(64);
  const OTHER = 'b'.repeat(64);

  assert.equal(computeStatus({ missing: true }), 'missing');

  assert.equal(computeStatus({ expectedHash: H, actualHash: H, profileEntry: null }), 'original');
  assert.equal(computeStatus({ expectedHash: H, actualHash: H, profileEntry: { appliedHash: OTHER } }), 'drifted');

  assert.equal(computeStatus({ expectedHash: H, actualHash: OTHER, profileEntry: { appliedHash: OTHER } }), 'replaced');
  assert.equal(computeStatus({ expectedHash: H, actualHash: OTHER, profileEntry: null }), 'foreign');
  // wpis w profilu jest, ale plik to cos trzeciego - tez obcy
  assert.equal(computeStatus({ expectedHash: H, actualHash: 'c'.repeat(64), profileEntry: { appliedHash: OTHER } }), 'foreign');

  // nazwa pliku bez hasha (teoretycznie mozliwa w innej wersji klienta)
  assert.equal(computeStatus({ expectedHash: null, actualHash: H, profileEntry: null }), 'unknown');
});

test('FILENAME_HASH akceptuje tylko nazwy sound-<64 hex>.ogg', () => {
  assert.ok(FILENAME_HASH.test(`sound-${'a'.repeat(64)}.ogg`));
  assert.ok(!FILENAME_HASH.test(`sound-${'a'.repeat(63)}.ogg`));
  assert.ok(!FILENAME_HASH.test('sound-xyz.ogg'));
  assert.ok(!FILENAME_HASH.test(`___sound-${'a'.repeat(64)}.ogg`));
  assert.ok(!FILENAME_HASH.test(`../sound-${'a'.repeat(64)}.ogg`));
});

// --- mapowanie akcji -------------------------------------------------------

test('buildUsageMap nazywa efekty z ESoundEffectType, a bezimienne po kategorii', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);
  const { enums } = await loadSnapshot();
  const usage = buildUsageMap(bank, enums);

  const first = usage.get(1);
  assert.ok(first.some((u) => u.event === 'SpellHaste' && u.category === 'SPELL_SUPPORT' && u.named));
  assert.ok(first.some((u) => u.event === 'DragonBark' && u.category === 'CREATURE_NOISE'));

  const second = usage.get(2);
  assert.ok(second.some((u) => u.event === 'raid_announcement #2776' && !u.named));

  // dzwiek 3 jest jednoczesnie petla ambience, petla obiektowa i muzyka
  const third = usage.get(3).map((u) => u.category).sort();
  assert.deepEqual(third, ['AMBIENCE_OBJECT', 'AMBIENCE_STREAM', 'MUSIC']);
  assert.ok(usage.get(3).some((u) => u.event === 'object loop (count>=1)'));
  assert.ok(usage.get(3).some((u) => u.ref === 'template#7'));
});

test('nieznana wartosc enuma nie wywala mapowania', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);
  const usage = buildUsageMap(bank, {}); // brak jakichkolwiek nazw
  assert.ok(usage.get(1).some((u) => u.category.startsWith('TYPE_')));
});

// --- buildCatalog ----------------------------------------------------------

test('buildCatalog laczy bank, nazwy i statusy', async () => {
  const cat = await buildCatalog({
    soundsDir: fixture.soundsDir,
    clientExe: null,
    profile: { entries: {} },
    cacheFile: null,
  });

  assert.equal(cat.entries.length, 3);
  assert.equal(cat.datFile, fixture.datName);
  assert.equal(cat.enumSource, 'snapshot');
  assert.deepEqual(cat.counts, {
    sounds: 3, numericEffects: 3, ambienceStreams: 1, ambienceObjectStreams: 1, musicTemplates: 1,
  });
  assert.ok(cat.entries.every((e) => e.status === 'original'));
  assert.ok(cat.entries.every((e) => e.size > 0));
  // dzwiek 1 ma nazwana akcje (SpellHaste); dzwiek 3 jest tylko ambience i muzyka,
  // wiec wszystkie jego etykiety sa generowane - renderer zsuwa go na koniec listy
  assert.equal(cat.entries.find((e) => e.soundId === 1).named, true);
  assert.equal(cat.entries.find((e) => e.soundId === 3).named, false);
  // pliki raw nie sa Vorbisem - probe ma zwrocic zera, nie wywalic sie
  assert.ok(cat.entries.every((e) => e.durationSec === 0 && e.sampleRate === 0));
});

test('buildCatalog raportuje postep hashowania', async () => {
  const seen = [];
  await buildCatalog({
    soundsDir: fixture.soundsDir,
    clientExe: null,
    profile: { entries: {} },
    cacheFile: null,
    onProgress: (done, total) => seen.push([done, total]),
  });
  assert.deepEqual(seen.at(-1), [3, 3]);
});

test('buildCatalog oznacza brakujacy plik jako missing', async () => {
  const copy = await createRawFixture();
  try {
    await fsp.rm(path.join(copy.soundsDir, copy.sounds[0].filename));
    const cat = await buildCatalog({
      soundsDir: copy.soundsDir, clientExe: null, profile: { entries: {} }, cacheFile: null,
    });
    const gone = cat.entries.find((e) => e.soundId === 1);
    assert.equal(gone.status, 'missing');
    assert.equal(gone.size, 0);
    assert.equal(gone.actualHash, null);
  } finally {
    await copy.cleanup();
  }
});

// --- cache hashy -----------------------------------------------------------

test('HashCache trafia po size+mtime i przelicza gdy plik sie zmienil', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-'));
  const file = path.join(dir, 'x.bin');
  try {
    await fsp.writeFile(file, 'aaa');
    const stat1 = await fsp.stat(file);
    const cache = new HashCache(path.join(dir, 'cache.json'));
    await cache.load();

    assert.equal(cache.get('x.bin', stat1), null, 'pusty cache nie moze trafiac');
    cache.set('x.bin', stat1, 'HASH1');
    assert.equal(cache.get('x.bin', stat1), 'HASH1');

    await cache.save();
    const reloaded = await new HashCache(path.join(dir, 'cache.json')).load();
    assert.equal(reloaded.get('x.bin', stat1), 'HASH1', 'cache musi przezyc zapis i odczyt');

    // inny rozmiar/mtime = pudlo
    assert.equal(reloaded.get('x.bin', { size: 999, mtimeMs: stat1.mtimeMs }), null);
    assert.equal(reloaded.get('x.bin', { size: stat1.size, mtimeMs: stat1.mtimeMs + 1000 }), null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('buildCatalog uzywa cache przy drugim przebiegu', async () => {
  const cacheFile = path.join(fixture.root, 'hashcache.json');
  const opts = {
    soundsDir: fixture.soundsDir, clientExe: null, profile: { entries: {} }, cacheFile,
  };
  const first = await buildCatalog(opts);
  const second = await buildCatalog(opts);
  assert.deepEqual(
    first.entries.map((e) => e.actualHash),
    second.entries.map((e) => e.actualHash)
  );
  const saved = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
  assert.equal(Object.keys(saved).length, 3);
});

test('sha256File liczy to samo co nazwa pliku w fixture', async () => {
  const s = fixture.sounds[0];
  assert.equal(await sha256File(path.join(fixture.soundsDir, s.filename)), s.hash);
});
