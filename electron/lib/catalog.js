'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { loadSoundBank } = require('./soundBank');
const { loadEnums } = require('./descriptors');
const { probeOgg } = require('./audio');

/**
 * Sklejenie banku dzwiekow z nazwami akcji + wyliczenie statusu kazdego pliku.
 *
 * Kluczowa wlasciwosc formatu: nazwa pliku `sound-<sha256>.ogg` JEST sha256 jego
 * oryginalnej tresci. Dzieki temu "oryginal vs podmianka" wykrywamy bez wlasnego
 * manifestu - wystarczy porownac hash pliku z hashem z nazwy.
 */

const FILENAME_HASH = /^sound-([0-9a-f]{64})\.ogg$/i;

function stripPrefix(name, prefix) {
  return name && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** Buduje mape soundId -> lista { event, category, ref }. */
function buildUsageMap(bank, enums) {
  const sfx = enums.ESoundEffectType || {};
  const nst = enums.ENumericSoundType || {};
  const mus = enums.EMusicType || {};
  const usage = new Map();

  const add = (soundId, entry) => {
    if (!soundId) return;
    if (!usage.has(soundId)) usage.set(soundId, []);
    usage.get(soundId).push(entry);
  };

  for (const eff of bank.numericEffects) {
    const category = stripPrefix(nst[eff.numericSoundType] || `TYPE_${eff.numericSoundType}`, 'NUMERIC_SOUND_TYPE_');
    const named = sfx[eff.id];
    const event = named ? stripPrefix(named, 'SOUND_EFFECT_TYPE_') : `${category.toLowerCase()} #${eff.id}`;
    for (const sid of eff.soundIds) add(sid, { event, category, ref: `nse#${eff.id}`, named: Boolean(named) });
  }

  for (const st of bank.ambienceStreams) {
    add(st.loopingSoundId, { event: 'ambience loop', category: 'AMBIENCE_STREAM', ref: `stream#${st.id}`, named: false });
  }

  for (const st of bank.ambienceObjectStreams) {
    for (const se of st.soundEffects) {
      add(se.loopingSoundId, {
        event: `object loop (count>=${se.count})`,
        category: 'AMBIENCE_OBJECT',
        ref: `objstream#${st.id}`,
        named: false,
      });
    }
  }

  for (const mt of bank.musicTemplates) {
    add(mt.soundId, {
      event: stripPrefix(mus[mt.musicType] || `TYPE_${mt.musicType}`, 'MUSIC_TYPE_').toLowerCase(),
      category: 'MUSIC',
      ref: `template#${mt.id}`,
      named: false,
    });
  }

  return usage;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Prosty pool - hashowanie 844 plikow (~110 MB) rownolegle, z raportem postepu. */
async function mapWithConcurrency(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let index = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done += 1;
      if (onProgress && (done % 25 === 0 || done === items.length)) onProgress(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Cache hashy - unika przeliczania 110 MB przy kazdym starcie. */
class HashCache {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    this.dirty = false;
  }

  async load() {
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw)) this.map.set(k, v);
    } catch {
      // brak cache przy pierwszym uruchomieniu
    }
    return this;
  }

  get(name, stat) {
    const hit = this.map.get(name);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.hash;
    return null;
  }

  set(name, stat, hash) {
    this.map.set(name, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
    this.dirty = true;
  }

  async save() {
    if (!this.dirty) return;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, JSON.stringify(Object.fromEntries(this.map)));
    this.dirty = false;
  }
}

function computeStatus({ expectedHash, actualHash, profileEntry, missing }) {
  if (missing) return 'missing';
  if (!expectedHash) return actualHash && profileEntry ? 'replaced' : 'unknown';
  if (actualHash === expectedHash) return profileEntry ? 'drifted' : 'original';
  if (profileEntry && profileEntry.appliedHash === actualHash) return 'replaced';
  return 'foreign';
}

/**
 * Buduje pelny katalog dla wskazanego klienta.
 * @param {{soundsDir:string, clientExe:string|null, profile:object, cacheFile:string, onProgress?:Function}} opts
 */
async function buildCatalog({ soundsDir, clientExe, profile = { entries: {} }, cacheFile, onProgress }) {
  const bank = await loadSoundBank(soundsDir);
  const enumInfo = await loadEnums(clientExe);
  const usage = buildUsageMap(bank, enumInfo.enums);

  const cache = cacheFile ? await new HashCache(cacheFile).load() : null;
  const sounds = [...bank.sounds.values()].sort((a, b) => a.id - b.id);

  const entries = await mapWithConcurrency(sounds, 8, async (sound) => {
    const file = path.join(soundsDir, sound.filename);
    const match = FILENAME_HASH.exec(sound.filename);
    const expectedHash = match ? match[1].toLowerCase() : null;

    let stat = null;
    try {
      stat = await fsp.stat(file);
    } catch {
      // plik zapowiedziany w banku, ale nieobecny na dysku
    }

    let actualHash = null;
    let probe = { channels: 0, sampleRate: 0, durationSec: 0 };
    if (stat) {
      actualHash = cache ? cache.get(sound.filename, stat) : null;
      if (!actualHash) {
        actualHash = await sha256File(file);
        if (cache) cache.set(sound.filename, stat, actualHash);
      }
      try {
        probe = await probeOgg(file);
      } catch {
        // uszkodzony/nietypowy plik - nie blokujemy calego katalogu
      }
    }

    const used = usage.get(sound.id) || [];
    const profileEntry = profile.entries ? profile.entries[String(sound.id)] || null : null;

    return {
      soundId: sound.id,
      file: sound.filename,
      isStream: sound.isStream,
      originalFilename: sound.originalFilename || null,
      events: [...new Set(used.map((u) => u.event))],
      categories: [...new Set(used.map((u) => u.category))],
      refs: [...new Set(used.map((u) => u.ref))],
      // Czy ktorakolwiek akcja ma prawdziwa nazwe z enuma, czy wszystkie sa
      // etykietami wygenerowanymi z kategorii i id. Renderer sortuje po tym,
      // zeby 406 wpisow typu "ambience_stream #2651" nie zajmowalo pierwszego ekranu.
      named: used.some((u) => u.named),
      size: stat ? stat.size : 0,
      durationSec: probe.durationSec,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
      expectedHash,
      actualHash,
      status: computeStatus({ expectedHash, actualHash, profileEntry, missing: !stat }),
      profile: profileEntry,
    };
  }, onProgress);

  if (cache) await cache.save();

  return {
    entries,
    datFile: bank.datFile,
    enumSource: enumInfo.source,
    enumNote: enumInfo.note || null,
    counts: {
      sounds: entries.length,
      numericEffects: bank.numericEffects.length,
      ambienceStreams: bank.ambienceStreams.length,
      ambienceObjectStreams: bank.ambienceObjectStreams.length,
      musicTemplates: bank.musicTemplates.length,
    },
  };
}

module.exports = { buildCatalog, buildUsageMap, sha256File, computeStatus, HashCache, FILENAME_HASH };
