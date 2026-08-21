'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readFields, readPackedVarints, readFloat } = require('./protobuf');

/**
 * Parser `tibia.protobuf.sound.Sounds` z <client>/packages/Tibia/sounds/sounds-<sha256>.dat
 *
 * message Sounds {
 *   repeated Sound sound = 1;
 *   repeated NumericSoundEffect numeric_sound_effect = 2;
 *   repeated AmbienceStream ambience_stream = 3;
 *   repeated AmbienceObjectStream ambience_object_stream = 4;
 *   repeated MusicTemplate music_template = 5;
 * }
 * Pelny schemat: docs/sounds.proto.txt + docs/sounds-common.proto.txt
 */

function parseSound(buf) {
  const out = { id: 0, filename: '', originalFilename: '', isStream: false };
  for (const f of readFields(buf)) {
    if (f.field === 1) out.id = f.value;
    else if (f.field === 2) out.filename = f.value.toString('utf8');
    else if (f.field === 3) out.originalFilename = f.value.toString('utf8');
    else if (f.field === 4) out.isStream = Boolean(f.value);
  }
  return out;
}

function parseMinMax(buf) {
  const out = { min: 0, max: 0 };
  for (const f of readFields(buf)) {
    if (f.field === 1) out.min = readFloat(f);
    else if (f.field === 2) out.max = readFloat(f);
  }
  return out;
}

function parseNumericSoundEffect(buf) {
  const out = { id: 0, numericSoundType: 0, soundIds: [], kind: 'none' };
  for (const f of readFields(buf)) {
    if (f.field === 1) out.id = f.value;
    else if (f.field === 2) out.numericSoundType = f.value;
    else if (f.field === 3) out.randomPitch = parseMinMax(f.value);
    else if (f.field === 4) out.randomVolume = parseMinMax(f.value);
    else if (f.field === 5) {
      // SimpleSoundEffect { uint32 sound_id = 1; }
      out.kind = 'simple';
      for (const g of readFields(f.value)) if (g.field === 1) out.soundIds.push(g.value);
    } else if (f.field === 6) {
      // RandomSoundEffect { repeated uint32 random_sound_id = 1; }
      out.kind = 'random';
      for (const g of readFields(f.value)) {
        if (g.field === 1) out.soundIds.push(...readPackedVarints(g));
      }
    }
  }
  return out;
}

function parseAmbienceStream(buf) {
  const out = { id: 0, loopingSoundId: 0, delayed: [] };
  for (const f of readFields(buf)) {
    if (f.field === 1) out.id = f.value;
    else if (f.field === 2) out.loopingSoundId = f.value;
    else if (f.field === 3) {
      const d = { numericSoundEffectId: 0, delaySeconds: 0 };
      for (const g of readFields(f.value)) {
        if (g.field === 1) d.numericSoundEffectId = g.value;
        else if (g.field === 2) d.delaySeconds = g.value;
      }
      out.delayed.push(d);
    }
  }
  return out;
}

function parseAmbienceObjectStream(buf) {
  const out = { id: 0, countedAppearanceTypes: [], soundEffects: [], maxSoundDistance: 0 };
  for (const f of readFields(buf)) {
    if (f.field === 1) out.id = f.value;
    else if (f.field === 2) out.countedAppearanceTypes.push(...readPackedVarints(f));
    else if (f.field === 3) {
      const s = { count: 0, loopingSoundId: 0 };
      for (const g of readFields(f.value)) {
        if (g.field === 1) s.count = g.value;
        else if (g.field === 2) s.loopingSoundId = g.value;
      }
      out.soundEffects.push(s);
    } else if (f.field === 4) out.maxSoundDistance = f.value;
  }
  return out;
}

function parseMusicTemplate(buf) {
  const out = { id: 0, soundId: 0, musicType: 0 };
  for (const f of readFields(buf)) {
    if (f.field === 1) out.id = f.value;
    else if (f.field === 2) out.soundId = f.value;
    else if (f.field === 3) out.musicType = f.value;
  }
  return out;
}

/** Parsuje surowy bufor sounds-*.dat. */
function parseSoundBank(buf) {
  const bank = {
    sounds: new Map(),
    numericEffects: [],
    ambienceStreams: [],
    ambienceObjectStreams: [],
    musicTemplates: [],
  };
  for (const f of readFields(buf)) {
    switch (f.field) {
      case 1: {
        const s = parseSound(f.value);
        bank.sounds.set(s.id, s);
        break;
      }
      case 2: bank.numericEffects.push(parseNumericSoundEffect(f.value)); break;
      case 3: bank.ambienceStreams.push(parseAmbienceStream(f.value)); break;
      case 4: bank.ambienceObjectStreams.push(parseAmbienceObjectStream(f.value)); break;
      case 5: bank.musicTemplates.push(parseMusicTemplate(f.value)); break;
      default: break; // nieznane pole z nowszej wersji klienta - ignorujemy
    }
  }
  return bank;
}

/**
 * Czyta catalog-sound.json i zwraca nazwe pliku .dat.
 * catalog-sound.json: [ { "file": "sounds-<sha256>.dat", "type": "sounds" } ]
 */
async function readCatalog(soundsDir) {
  const raw = await fs.readFile(path.join(soundsDir, 'catalog-sound.json'), 'utf8');
  const entries = JSON.parse(raw);
  const found = entries.find((e) => e.type === 'sounds' && e.file);
  if (!found) throw new Error('catalog-sound.json nie zawiera wpisu type="sounds"');
  return found.file;
}

/** Wczytuje i parsuje bank z katalogu sounds/ wskazanego klienta. */
async function loadSoundBank(soundsDir) {
  const datName = await readCatalog(soundsDir);
  const datPath = path.join(soundsDir, datName);
  const buf = await fs.readFile(datPath);
  const bank = parseSoundBank(buf);
  bank.datFile = datName;
  return bank;
}

module.exports = { parseSoundBank, readCatalog, loadSoundBank };
