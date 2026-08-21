'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { FILENAME_HASH, sha256File } = require('./catalog');
const { probeOgg } = require('./audio');
const { backupOriginal, writeAtomic, saveProfile } = require('./profile');

/**
 * Przenosny profil podmianek.
 *
 * Sam plik profilu nie wystarczy - wskazuje na pliki w vaulcie, ktorych na innej
 * maszynie (albo po przeinstalowaniu klienta w inne miejsce) nie ma. Dlatego eksport
 * pakuje dzwieki razem z opisem, w jednym pliku JSON. Audio jest juz skonwertowane
 * do formatu gry, wiec import nie potrzebuje ffmpega.
 *
 * Zastosowanie: po aktualizacji klienta, przenosinach na inny komputer albo po
 * skasowaniu danych aplikacji - wgrywasz plik i podmianki wracaja.
 */

const FORMAT = 'tibia-sounds-config/profile';
const FORMAT_VERSION = 1;
const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;

/**
 * Sklada przenosny profil z aktualnego vaulta.
 * @returns {Promise<{bundle: object, bytes: number, skipped: Array}>}
 */
async function buildBundle({ vault, profile, appVersion = null, clientVersion = null }) {
  const entries = [];
  const skipped = [];
  let bytes = 0;

  for (const entry of Object.values(profile.entries || {})) {
    const libPath = path.join(vault.dir, entry.libraryFile || '');
    let audio;
    try {
      audio = await fsp.readFile(libPath);
    } catch {
      skipped.push({ soundId: entry.soundId, powod: 'brak pliku w vault/library' });
      continue;
    }
    bytes += audio.length;
    if (bytes > MAX_BUNDLE_BYTES) {
      throw new Error(`profil przekroczyl ${Math.round(MAX_BUNDLE_BYTES / 1048576)} MB - wyeksportuj mniej podmianek`);
    }
    entries.push({
      soundId: entry.soundId,
      file: entry.file,
      originalHash: entry.originalHash,
      mode: entry.mode,
      sourceName: entry.sourceName,
      origin: entry.origin || null,
      audioBase64: audio.toString('base64'),
    });
  }

  return {
    bundle: {
      format: FORMAT,
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion,
      clientVersion,
      entries,
    },
    bytes,
    skipped,
  };
}

/** Sprawdza, czy wczytany plik to nasz profil. Rzuca z czytelnym powodem. */
function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new Error('plik nie jest poprawnym profilem');
  if (bundle.format !== FORMAT) throw new Error('to nie jest profil Tibia Sounds Config');
  if (bundle.version > FORMAT_VERSION) {
    throw new Error(`profil zapisano nowsza wersja aplikacji (format ${bundle.version})`);
  }
  if (!Array.isArray(bundle.entries)) throw new Error('profil nie zawiera listy podmianek');
  return bundle;
}

/**
 * Wgrywa podmianki z przenosnego profilu do wskazanego klienta.
 *
 * Pomija wpisy, ktorych dzwiek nie istnieje juz w tej wersji klienta - po aktualizacji
 * Tibii czesc plikow moze miec inna zawartosc, a wiec i inna nazwe. Taki wpis jest
 * raportowany, a nie po cichu gubiony.
 */
async function applyBundle({ bundle, soundsDir, vault, profile }) {
  validateBundle(bundle);

  const applied = [];
  const skipped = [];

  for (const entry of bundle.entries) {
    const match = FILENAME_HASH.exec(entry.file || '');
    if (!match) {
      skipped.push({ soundId: entry.soundId, nazwa: entry.sourceName, powod: 'nieoczekiwana nazwa pliku' });
      continue;
    }

    // Czy ten dzwiek w ogole istnieje w tej wersji klienta?
    const target = path.join(soundsDir, entry.file);
    try {
      await fsp.access(target);
    } catch {
      skipped.push({
        soundId: entry.soundId,
        nazwa: entry.sourceName,
        powod: 'tego dzwieku nie ma w biezacej wersji klienta',
      });
      continue;
    }

    let audio;
    try {
      audio = Buffer.from(entry.audioBase64 || '', 'base64');
      if (!audio.length) throw new Error('pusty');
    } catch {
      skipped.push({ soundId: entry.soundId, nazwa: entry.sourceName, powod: 'uszkodzone audio w profilu' });
      continue;
    }

    try {
      // Kopia oryginalu musi powstac zanim cokolwiek nadpiszemy.
      await backupOriginal(soundsDir, vault, entry.file);

      const libraryFile = path.join(vault.libraryDir, `${crypto.randomUUID()}.ogg`);
      await fsp.mkdir(vault.libraryDir, { recursive: true });
      await fsp.writeFile(libraryFile, audio);

      const probe = await probeOgg(libraryFile);
      if (!probe.sampleRate) {
        await fsp.rm(libraryFile, { force: true });
        skipped.push({ soundId: entry.soundId, nazwa: entry.sourceName, powod: 'plik w profilu nie jest poprawnym ogg' });
        continue;
      }

      await writeAtomic(target, libraryFile);
      const appliedHash = await sha256File(target);

      profile.entries[String(entry.soundId)] = {
        soundId: entry.soundId,
        file: entry.file,
        originalHash: match[1].toLowerCase(),
        mode: entry.mode || 'replace',
        sourceName: entry.sourceName || '(z profilu)',
        libraryFile: path.relative(vault.dir, libraryFile).split(path.sep).join('/'),
        appliedHash,
        updatedAt: new Date().toISOString(),
        origin: entry.origin || null,
      };
      applied.push({ soundId: entry.soundId, nazwa: entry.sourceName });
    } catch (err) {
      skipped.push({ soundId: entry.soundId, nazwa: entry.sourceName, powod: err.message });
    }
  }

  if (applied.length) await saveProfile(vault, profile);
  return { applied, skipped };
}

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  MAX_BUNDLE_BYTES,
  buildBundle,
  validateBundle,
  applyBundle,
};
