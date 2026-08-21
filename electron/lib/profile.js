'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { sha256File, FILENAME_HASH } = require('./catalog');
const { convertToOgg, makeSilence, probeOgg } = require('./audio');

/**
 * Profil podmian + vault z oryginalami.
 *
 * vault/
 *   clients/<slug>/profile.json      { version, clientRoot, entries: { "<soundId>": wpis } }
 *   clients/<slug>/originals/        kopie oryginalnych .ogg (nazwa = sound-<sha256>.ogg)
 *   clients/<slug>/library/          skonwertowane podmianki (<uuid>.ogg)
 *   clients/<slug>/hashcache.json
 *
 * Oryginaly trzymamy lokalnie, bo pobranie ich z static.tibia.com jest zablokowane
 * przez Cloudflare (sprawdzone: HTTP 403 + cf-mitigated: challenge).
 */

const PROFILE_VERSION = 1;

function slugForClient(clientRoot) {
  const norm = path.resolve(clientRoot).toLowerCase();
  const hash = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 10);
  const base = path.basename(norm).replace(/[^a-z0-9]+/gi, '-').slice(0, 24) || 'client';
  return `${base}-${hash}`;
}

function vaultForClient(vaultRoot, clientRoot) {
  const dir = path.join(vaultRoot, 'clients', slugForClient(clientRoot));
  return {
    dir,
    profileFile: path.join(dir, 'profile.json'),
    originalsDir: path.join(dir, 'originals'),
    libraryDir: path.join(dir, 'library'),
    cacheFile: path.join(dir, 'hashcache.json'),
  };
}

async function ensureVault(vault) {
  await fsp.mkdir(vault.originalsDir, { recursive: true });
  await fsp.mkdir(vault.libraryDir, { recursive: true });
}

async function loadProfile(vault, clientRoot) {
  try {
    const raw = JSON.parse(await fsp.readFile(vault.profileFile, 'utf8'));
    if (!raw.entries) raw.entries = {};
    return raw;
  } catch {
    return { version: PROFILE_VERSION, clientRoot, entries: {} };
  }
}

/**
 * Profil to jedyny zapis tego, co uzytkownik podmienil. Przerwany zapis (zamkniecie
 * okna, brak miejsca) zostawilby uciety JSON, po ktorym loadProfile wraca do pustego
 * profilu i wszystkie podmianki staja sie 'foreign' - dlatego zawsze przez tmp+rename.
 */
async function saveProfile(vault, profile) {
  await fsp.mkdir(vault.dir, { recursive: true });
  await writeTextAtomic(vault.profileFile, JSON.stringify(profile, null, 2));
}

/** Zapis atomowy - najpierw .tmp obok celu, potem rename. */
async function writeAtomic(destPath, srcPath) {
  const tmp = `${destPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  await fsp.copyFile(srcPath, tmp);
  try {
    await fsp.rename(tmp, destPath);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/** To samo co writeAtomic, tylko zrodlem jest tekst, a nie plik. */
async function writeTextAtomic(destPath, text) {
  const tmp = `${destPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  await fsp.writeFile(tmp, text);
  try {
    await fsp.rename(tmp, destPath);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Popularny recznie robiony backup: oryginal przemianowany na `___sound-<hash>.ogg`
 * obok podmianki. Jesli taki plik istnieje i ma poprawny hash, traktujemy go
 * jak zrodlo oryginalu.
 */
const MANUAL_BACKUP_PREFIX = '___';

async function findManualBackup(soundsDir, fileName, expectedHash) {
  const candidate = path.join(soundsDir, MANUAL_BACKUP_PREFIX + fileName);
  try {
    if ((await sha256File(candidate)) === expectedHash) return candidate;
  } catch {
    // nie ma recznej kopii
  }
  return null;
}

/**
 * Zabezpiecza kopie oryginalu zanim cokolwiek nadpiszemy.
 * Kolejnosc zrodel: vault -> plik w kliencie (jesli to oryginal) -> reczny backup `___`.
 */
async function backupOriginal(soundsDir, vault, fileName) {
  const match = FILENAME_HASH.exec(fileName);
  if (!match) throw new Error(`nieoczekiwana nazwa pliku: ${fileName}`);
  const expected = match[1].toLowerCase();
  const backupPath = path.join(vault.originalsDir, fileName);

  try {
    const have = await sha256File(backupPath);
    if (have === expected) return { backupPath, created: false, from: 'vault' };
    await fsp.rm(backupPath, { force: true }); // uszkodzona kopia
  } catch {
    // brak kopii - lecimy dalej
  }

  const livePath = path.join(soundsDir, fileName);
  let source = null;
  let from = null;
  try {
    if ((await sha256File(livePath)) === expected) {
      source = livePath;
      from = 'client';
    }
  } catch {
    // pliku moze nie byc wcale
  }
  if (!source) {
    source = await findManualBackup(soundsDir, fileName, expected);
    from = source ? 'manual' : null;
  }
  if (!source) {
    throw new Error(
      'plik w kliencie nie jest oryginalem, a nie mam jego kopii. ' +
      'Uruchom launcher Tibii - zweryfikuje pliki i pobierze oryginal, wtedy sprobuj ponownie.'
    );
  }

  await fsp.mkdir(vault.originalsDir, { recursive: true });
  await writeAtomic(backupPath, source);
  return { backupPath, created: true, from };
}

/**
 * Podmienia dzwiek. `mode`:
 *   'replace' - konwertuje srcPath (mp3/wav/flac/...) na ogg
 *   'mute'    - generuje cisze
 * Parametry (sampleRate, channels) bierzemy z oryginalu, zeby silnik dostal
 * to samo co wczesniej.
 */
async function applySound({
  soundsDir, vault, profile, entryInfo, srcPath, mode = 'replace', quality = 5, source = null,
}) {
  const { file: fileName, soundId } = entryInfo;
  await ensureVault(vault);
  const { backupPath } = await backupOriginal(soundsDir, vault, fileName);

  const original = await probeOgg(backupPath);
  const libraryFile = path.join(vault.libraryDir, `${crypto.randomUUID()}.ogg`);

  if (mode === 'mute') {
    await makeSilence(libraryFile, {
      sampleRate: original.sampleRate || 44100,
      channels: original.channels || 1,
      durationSec: 0.05,
    });
  } else {
    if (!srcPath) throw new Error('brak pliku zrodlowego');
    await convertToOgg(srcPath, libraryFile, {
      sampleRate: original.sampleRate || undefined,
      channels: original.channels || undefined,
      quality,
    });
  }

  const target = path.join(soundsDir, fileName);
  await writeAtomic(target, libraryFile);
  const appliedHash = await sha256File(target);

  profile.entries[String(soundId)] = {
    soundId,
    file: fileName,
    originalHash: FILENAME_HASH.exec(fileName)[1].toLowerCase(),
    mode,
    sourceName: mode === 'mute' ? '(cisza)' : (source && source.title) || path.basename(srcPath),
    libraryFile: path.relative(vault.dir, libraryFile).split(path.sep).join('/'),
    appliedHash,
    updatedAt: new Date().toISOString(),
    // Pochodzenie pliku pobranego z sieci - zeby po miesiacu bylo wiadomo, skad jest
    // i czy licencja wymaga atrybucji. Dla pliku z dysku pozostaje null.
    origin: source ? {
      provider: source.providerId || null,
      url: source.pageUrl || source.audioUrl || null,
      author: source.author || null,
      license: source.license || null,
      licenseUrl: source.licenseUrl || null,
      attribution: source.attribution || null,
      // Wskazanie na wpis biblioteki, jesli dzwiek stamtad pochodzi. Dzieki temu
      // zestaw dzwiekow potrafi odtworzyc uklad i widac, ze nic sie nie zmienilo.
      libraryId: source.libraryId || null,
    } : null,
  };
  await saveProfile(vault, profile);
  return profile.entries[String(soundId)];
}

/**
 * Wgrywa oryginal z powrotem do klienta. Nie rusza profilu ani go nie zapisuje -
 * to robi wolajacy, bo przy zestawach dzwiekow zapisujemy profil raz na cala partie,
 * a nie po kazdym z kilkuset plikow.
 */
async function restoreOriginalFile(soundsDir, vault, fileName) {
  const match = FILENAME_HASH.exec(fileName);
  if (!match) throw new Error(`nieoczekiwana nazwa pliku: ${fileName}`);
  const expected = match[1].toLowerCase();
  const backupPath = path.join(vault.originalsDir, fileName);

  let source = null;
  try {
    if ((await sha256File(backupPath)) === expected) source = backupPath;
  } catch {
    // brak kopii w vaulcie
  }
  if (!source) source = await findManualBackup(soundsDir, fileName, expected);
  if (!source) {
    throw new Error(
      'nie mam oryginalu tego dzwieku (ani w vaulcie, ani jako ___kopia w kliencie). ' +
      'Uruchom launcher Tibii - zweryfikuje pliki i pobierze oryginal.'
    );
  }

  await writeAtomic(path.join(soundsDir, fileName), source);
  return source;
}

/** Przywraca oryginal z vaulta i usuwa wpis z profilu. */
async function resetSound({ soundsDir, vault, profile, fileName, soundId }) {
  await restoreOriginalFile(soundsDir, vault, fileName);
  delete profile.entries[String(soundId)];
  await saveProfile(vault, profile);
  return { restored: true };
}

/**
 * Po patchu launchera podmianki wracaja do oryginalow (status 'drifted').
 * Ta funkcja wgrywa je z powrotem z vault/library.
 */
async function reapplyDrifted({ soundsDir, vault, profile, entries }) {
  const drifted = entries.filter((e) => e.status === 'drifted');
  const results = [];
  for (const entry of drifted) {
    const rec = profile.entries[String(entry.soundId)];
    if (!rec) continue;
    const libPath = path.join(vault.dir, rec.libraryFile);
    try {
      await fsp.access(libPath);
    } catch {
      results.push({ soundId: entry.soundId, ok: false, error: 'brak pliku w vault/library' });
      continue;
    }
    try {
      await writeAtomic(path.join(soundsDir, entry.file), libPath);
      rec.appliedHash = await sha256File(path.join(soundsDir, entry.file));
      rec.updatedAt = new Date().toISOString();
      results.push({ soundId: entry.soundId, ok: true });
    } catch (err) {
      results.push({ soundId: entry.soundId, ok: false, error: err.message });
    }
  }
  if (results.some((r) => r.ok)) await saveProfile(vault, profile);
  return results;
}

/**
 * Wgrywa cala partie zmian z zestawu dzwiekow.
 *
 * Dwie rzeczy decyduja o tym, ze dziala to w sekundach, a nie minutach:
 *  - cisza i konwersje z biblioteki sa liczone RAZ na kombinacje sampleRate/kanaly
 *    i wspoldzielone przez wszystkie dzwieki (w realnym banku sa tylko dwie takie
 *    kombinacje, wiec zamiast 844 wywolan ffmpega mamy dwa),
 *  - profil zapisujemy zbiorczo, a nie po kazdym pliku.
 *
 * Blad na jednym dzwieku nie przerywa partii - trafia do `bledy` i lecimy dalej.
 * `shouldContinue` jest sprawdzane co kilkadziesiat plikow, zeby dlugie wgrywanie
 * dalo sie przerwac i zeby wylapac uruchomienie gry w trakcie.
 */
async function applyPreset({
  soundsDir, vault, profile, entries, changes, libraryDir = null,
  onProgress = null, shouldContinue = null, quality = 5,
}) {
  await ensureVault(vault);
  const byId = new Map(entries.map((e) => [e.soundId, e]));
  const cache = new Map();
  const wynik = { zmienione: 0, bledy: [], przerwane: false };

  /** Gotowy plik w vault/library, wspoldzielony przez wszystkie dzwieki o tych parametrach. */
  const shared = async (key, build) => {
    if (cache.has(key)) return cache.get(key);
    const file = path.join(vault.libraryDir, `${key}.ogg`);
    try {
      await fsp.access(file);
    } catch {
      await build(file);
    }
    cache.set(key, file);
    return file;
  };

  for (let i = 0; i < changes.length; i += 1) {
    if (shouldContinue && i > 0 && i % 40 === 0 && !(await shouldContinue())) {
      wynik.przerwane = true;
      break;
    }

    const { soundId, action } = changes[i];
    const entry = byId.get(soundId);
    if (!entry) continue;

    try {
      if (action === 'original') {
        await restoreOriginalFile(soundsDir, vault, entry.file);
        delete profile.entries[String(soundId)];
      } else {
        const { backupPath } = await backupOriginal(soundsDir, vault, entry.file);
        const orig = await probeOgg(backupPath);
        const rate = orig.sampleRate || 44100;
        const ch = orig.channels || 1;

        let src;
        let mode;
        let sourceName;
        let origin = null;

        if (action === 'mute') {
          mode = 'mute';
          sourceName = '(cisza)';
          src = await shared(`silence-${rate}-${ch}`, (file) =>
            makeSilence(file, { sampleRate: rate, channels: ch, durationSec: 0.05 }));
        } else {
          if (!libraryDir) throw new Error('brak biblioteki dzwiekow');
          const zrodlo = await libraryDir(action.libraryId);
          if (!zrodlo) throw new Error('dzwiek z biblioteki zostal usuniety');
          mode = 'replace';
          sourceName = zrodlo.name;
          origin = { ...(zrodlo.origin || {}), libraryId: action.libraryId };
          src = await shared(`lib-${action.libraryId}-${rate}-${ch}`, (file) =>
            convertToOgg(zrodlo.path, file, { sampleRate: rate, channels: ch, quality }));
        }

        const target = path.join(soundsDir, entry.file);
        await writeAtomic(target, src);

        profile.entries[String(soundId)] = {
          soundId,
          file: entry.file,
          originalHash: FILENAME_HASH.exec(entry.file)[1].toLowerCase(),
          mode,
          sourceName,
          libraryFile: path.relative(vault.dir, src).split(path.sep).join('/'),
          appliedHash: await sha256File(target),
          updatedAt: new Date().toISOString(),
          origin: origin && {
            provider: origin.providerId || origin.provider || null,
            url: origin.pageUrl || origin.url || null,
            author: origin.author || null,
            license: origin.license || null,
            licenseUrl: origin.licenseUrl || null,
            attribution: origin.attribution || null,
            libraryId: origin.libraryId || null,
          },
        };
      }
      wynik.zmienione += 1;
    } catch (err) {
      wynik.bledy.push({ soundId, powod: err.message });
    }

    // Zapis co jakis czas, zeby przerwanie w polowie nie kosztowalo calej partii.
    if (i > 0 && i % 100 === 0) await saveProfile(vault, profile);
    if (onProgress) onProgress(i + 1, changes.length);
  }

  await saveProfile(vault, profile);
  return wynik;
}

module.exports = {
  PROFILE_VERSION,
  vaultForClient,
  slugForClient,
  ensureVault,
  loadProfile,
  saveProfile,
  backupOriginal,
  findManualBackup,
  MANUAL_BACKUP_PREFIX,
  applySound,
  resetSound,
  restoreOriginalFile,
  applyPreset,
  reapplyDrifted,
  writeAtomic,
  writeTextAtomic,
};
