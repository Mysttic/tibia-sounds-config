'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createRawFixture } = require('../tools/make-fixture');
const { parseSoundBank, readCatalog, loadSoundBank } = require('../electron/lib/soundBank');

let fixture;

test.before(async () => { fixture = await createRawFixture(); });
test.after(async () => { await fixture.cleanup(); });

test('readCatalog wyciaga nazwe .dat z catalog-sound.json', async () => {
  assert.equal(await readCatalog(fixture.soundsDir), fixture.datName);
});

test('readCatalog rzuca gdy brakuje wpisu type="sounds"', async () => {
  const dir = path.join(fixture.root, 'pusty');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'catalog-sound.json'), '[{"type":"cos","file":"x"}]');
  await assert.rejects(readCatalog(dir), /type="sounds"/);
});

test('loadSoundBank czyta wszystkie piec sekcji Sounds', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);

  assert.equal(bank.datFile, fixture.datName);
  assert.equal(bank.sounds.size, 3);
  assert.equal(bank.numericEffects.length, 3);
  assert.equal(bank.ambienceStreams.length, 1);
  assert.equal(bank.ambienceObjectStreams.length, 1);
  assert.equal(bank.musicTemplates.length, 1);
});

test('Sound: id, filename i flaga is_stream', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);
  assert.equal(bank.sounds.get(1).filename, fixture.sounds[0].filename);
  assert.equal(bank.sounds.get(1).isStream, false);
  assert.equal(bank.sounds.get(3).isStream, true);
  // original_filename jest puste we wszystkich znanych buildach klienta
  assert.equal(bank.sounds.get(1).originalFilename, '');
});

test('NumericSoundEffect: simple i random (packed) daja te sama liste soundIds', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);

  const simple = bank.numericEffects.find((e) => e.id === 1006);
  assert.equal(simple.kind, 'simple');
  assert.equal(simple.numericSoundType, 3);
  assert.deepEqual(simple.soundIds, [1]);

  const random = bank.numericEffects.find((e) => e.id === 2508);
  assert.equal(random.kind, 'random');
  assert.equal(random.numericSoundType, 5);
  assert.deepEqual(random.soundIds, [1, 2]);
});

test('AmbienceStream: petla + opoznione efekty', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);
  const st = bank.ambienceStreams[0];
  assert.equal(st.id, 3);
  assert.equal(st.loopingSoundId, 3);
  assert.deepEqual(st.delayed, [{ numericSoundEffectId: 2776, delaySeconds: 45 }]);
});

test('AmbienceObjectStream: progi i lista appearance id', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);
  const st = bank.ambienceObjectStreams[0];
  assert.equal(st.id, 8);
  assert.deepEqual(st.countedAppearanceTypes, [2112, 2113]);
  assert.deepEqual(st.soundEffects, [{ count: 1, loopingSoundId: 3 }]);
  assert.equal(st.maxSoundDistance, 3);
});

test('MusicTemplate: powiazanie z dzwiekiem i typem muzyki', async () => {
  const bank = await loadSoundBank(fixture.soundsDir);
  assert.deepEqual(bank.musicTemplates[0], { id: 7, soundId: 3, musicType: 1 });
});

test('nieznane pola z nowszej wersji klienta sa ignorowane, nie wywalaja parsera', () => {
  const known = Buffer.from([
    0x0a, 0x06, 0x08, 0x01, 0x12, 0x02, 0x61, 0x62, // Sound{id:1, filename:"ab"}
  ]);
  const future = Buffer.concat([known, Buffer.from([0x42, 0x02, 0xde, 0xad])]); // pole 8
  const bank = parseSoundBank(future);
  assert.equal(bank.sounds.size, 1);
  assert.equal(bank.sounds.get(1).filename, 'ab');
});
