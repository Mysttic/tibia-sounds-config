'use strict';

/**
 * Generuje syntetycznego mini-klienta Tibii do testow.
 *
 * Dzieki temu caly cykl (podmiana / wyciszenie / reset / drift / reapply) testujemy
 * bez dotykania prawdziwej instalacji gry i bez trzymania assetow CipSoftu w repo.
 *
 * Dwa warianty:
 *   createFixture()     - prawdziwe pliki .ogg wygenerowane ffmpegiem (potrzebne do
 *                         testow konwersji i odczytu parametrow audio)
 *   createRawFixture()  - pliki o losowej tresci, bez ffmpega; wystarczaja do testow
 *                         parsera banku, statusow i sciezek
 *
 * Uzycie: node tools/make-fixture.js [katalog]
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { runFfmpeg } = require('../electron/lib/audio');

// --- minimalny zapis protobuf ---------------------------------------------

function varint(value) {
  const bytes = [];
  let v = value;
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

const tag = (field, wire) => varint((field << 3) | wire);
const fieldVarint = (field, value) => Buffer.concat([tag(field, 0), varint(value)]);
const fieldBytes = (field, buf) => Buffer.concat([tag(field, 2), varint(buf.length), buf]);
const fieldString = (field, str) => fieldBytes(field, Buffer.from(str, 'utf8'));

// --- wspolny bank ----------------------------------------------------------

/**
 * Sklada bufor `sounds-<sha256>.dat` dla podanych dzwiekow.
 * Zawartosc jest celowo skromna, ale pokrywa wszystkie 5 sekcji Sounds.
 */
function buildBankBuffer(sounds) {
  const parts = [];

  for (const s of sounds) {
    parts.push(fieldBytes(1, Buffer.concat([
      fieldVarint(1, s.id),
      fieldString(2, s.filename),
      fieldVarint(4, s.isStream ? 1 : 0),
    ])));
  }

  // NumericSoundEffect 1006 = SOUND_EFFECT_TYPE_SpellHaste, typ 3 = SPELL_SUPPORT
  parts.push(fieldBytes(2, Buffer.concat([
    fieldVarint(1, 1006),
    fieldVarint(2, 3),
    fieldBytes(5, fieldVarint(1, 1)),
  ])));

  // NumericSoundEffect 2776 = bez nazwy w enumie, typ 17 = RAID_ANNOUNCEMENT
  parts.push(fieldBytes(2, Buffer.concat([
    fieldVarint(1, 2776),
    fieldVarint(2, 17),
    fieldBytes(5, fieldVarint(1, 2)),
  ])));

  // RandomSoundEffect z packed varintami - typ 5 = CREATURE_NOISE
  parts.push(fieldBytes(2, Buffer.concat([
    fieldVarint(1, 2508),
    fieldVarint(2, 5),
    fieldBytes(6, fieldBytes(1, Buffer.concat([varint(1), varint(2)]))),
  ])));

  // AmbienceStream 3: petla na dzwieku 3 + jeden opozniony efekt
  parts.push(fieldBytes(3, Buffer.concat([
    fieldVarint(1, 3),
    fieldVarint(2, 3),
    fieldBytes(3, Buffer.concat([fieldVarint(1, 2776), fieldVarint(2, 45)])),
  ])));

  // AmbienceObjectStream 8: petla przy >=1 obiekcie z listy
  parts.push(fieldBytes(4, Buffer.concat([
    fieldVarint(1, 8),
    fieldBytes(2, Buffer.concat([varint(2112), varint(2113)])),
    fieldBytes(3, Buffer.concat([fieldVarint(1, 1), fieldVarint(2, 3)])),
    fieldVarint(4, 3),
  ])));

  // MusicTemplate 7 -> dzwiek 3, typ 1 = MUSIC_TYPE_MUSIC
  parts.push(fieldBytes(5, Buffer.concat([
    fieldVarint(1, 7),
    fieldVarint(2, 3),
    fieldVarint(3, 1),
  ])));

  return Buffer.concat(parts);
}

async function writeClientSkeleton(root, sounds) {
  const soundsDir = path.join(root, 'packages', 'Tibia', 'sounds');
  await fsp.mkdir(soundsDir, { recursive: true });

  const dat = buildBankBuffer(sounds);
  const datName = `sounds-${crypto.createHash('sha256').update(dat).digest('hex')}.dat`;
  await fsp.writeFile(path.join(soundsDir, datName), dat);
  await fsp.writeFile(
    path.join(soundsDir, 'catalog-sound.json'),
    JSON.stringify([{ file: datName, type: 'sounds' }], null, 1)
  );
  await fsp.writeFile(
    path.join(root, 'packages', 'Tibia', 'package.json'),
    JSON.stringify({ version: '0.0.0-fixture', files: [] }, null, 1)
  );
  return { soundsDir, datName };
}

// --- wariant z prawdziwym audio -------------------------------------------

const TONES = [
  { freq: 440, seconds: 0.4, rate: 44100, channels: 1 },
  { freq: 660, seconds: 0.6, rate: 44100, channels: 1 },
  { freq: 220, seconds: 1.2, rate: 48000, channels: 2 },
];

async function makeTone(dest, { freq, seconds, rate, channels }) {
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${freq}:sample_rate=${rate}:duration=${seconds}`,
    '-ac', String(channels),
    '-c:a', 'libvorbis', '-q:a', '3',
    dest,
  ]);
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
}

/** Mini-klient z prawdziwymi plikami Vorbis. Wymaga ffmpega. */
async function createFixture(baseDir) {
  const root = baseDir || (await fsp.mkdtemp(path.join(os.tmpdir(), 'tibia-fixture-')));
  const soundsDir = path.join(root, 'packages', 'Tibia', 'sounds');
  await fsp.mkdir(soundsDir, { recursive: true });

  const sounds = [];
  for (let i = 0; i < TONES.length; i += 1) {
    const tmp = path.join(soundsDir, `tone-${i}.ogg`);
    await makeTone(tmp, TONES[i]);
    const hash = await sha256(tmp);
    const filename = `sound-${hash}.ogg`;
    await fsp.rename(tmp, path.join(soundsDir, filename));
    sounds.push({ id: i + 1, filename, hash, isStream: i === 2, tone: TONES[i] });
  }

  const { datName } = await writeClientSkeleton(root, sounds);
  return {
    root, soundsDir, datName, sounds,
    cleanup: () => fsp.rm(root, { recursive: true, force: true }),
  };
}

/** Mini-klient bez ffmpega: pliki maja losowa tresc, ale poprawne nazwy-hashe. */
async function createRawFixture(baseDir) {
  const root = baseDir || (await fsp.mkdtemp(path.join(os.tmpdir(), 'tibia-raw-')));
  const soundsDir = path.join(root, 'packages', 'Tibia', 'sounds');
  await fsp.mkdir(soundsDir, { recursive: true });

  const sounds = [];
  for (let i = 0; i < 3; i += 1) {
    // deterministyczna tresc - te same fixture'y przy kazdym uruchomieniu
    const body = Buffer.from(`fixture-sound-${i}`.repeat(64), 'utf8');
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const filename = `sound-${hash}.ogg`;
    await fsp.writeFile(path.join(soundsDir, filename), body);
    sounds.push({ id: i + 1, filename, hash, isStream: i === 2, body });
  }

  const { datName } = await writeClientSkeleton(root, sounds);
  return {
    root, soundsDir, datName, sounds,
    cleanup: () => fsp.rm(root, { recursive: true, force: true }),
  };
}

/** Pomocnik do testow: plik zrodlowy mp3 do podmiany. Wymaga ffmpega. */
async function makeSourceMp3(dest, { freq = 880, seconds = 0.5 } = {}) {
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:duration=${seconds}`,
    '-c:a', 'libmp3lame', '-b:a', '128k',
    dest,
  ]);
  return dest;
}

module.exports = { createFixture, createRawFixture, makeSourceMp3, buildBankBuffer };

if (require.main === module) {
  createFixture(process.argv[2])
    .then((f) => {
      console.log('fixture:', f.root);
      console.log('sounds :', f.soundsDir);
      for (const s of f.sounds) console.log(`  #${s.id} ${s.filename}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
