'use strict';

/**
 * Narzedzie CLI wokol VERSION.md - zrodla prawdy dla numeru wersji.
 *
 * package.json musi ten numer powtarzac, bo z niego korzysta electron-builder przy
 * nazywaniu artefaktow. Parser siedzi w electron/lib/version.js, zeby aplikacja
 * i CI czytaly wersje dokladnie tak samo.
 *
 * Uzycie:
 *   node tools/version.js            wypisz wersje z VERSION.md
 *   node tools/version.js --check    zwroc blad gdy package.json sie rozjechal
 *   node tools/version.js --sync     przepisz wersje do package.json
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseVersion } = require('../electron/lib/version');

const ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'VERSION.md');
const PACKAGE_FILE = path.join(ROOT, 'package.json');

function readVersion(file = VERSION_FILE) {
  return parseVersion(fs.readFileSync(file, 'utf8'));
}

function readPackageVersion(file = PACKAGE_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

/** @returns {{ok: boolean, version: string, packageVersion: string}} */
function check() {
  const version = readVersion();
  const packageVersion = readPackageVersion();
  return { ok: version === packageVersion, version, packageVersion };
}

/** Przepisuje wersje z VERSION.md do package.json. @returns {boolean} czy cos zmieniono */
function sync() {
  const version = readVersion();
  const raw = fs.readFileSync(PACKAGE_FILE, 'utf8');
  if (JSON.parse(raw).version === version) return false;
  // podmiana punktowa, zeby nie przeformatowac calego pliku
  const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, (_all, before, after) =>
    `${before}${version}${after}`);
  if (JSON.parse(updated).version !== version) {
    throw new Error('nie udalo sie podmienic pola "version" w package.json');
  }
  fs.writeFileSync(PACKAGE_FILE, updated);
  return true;
}

function main() {
  const arg = process.argv[2];

  if (arg === '--check') {
    const res = check();
    if (res.ok) {
      console.log(`wersja ${res.version} - VERSION.md i package.json zgodne`);
      return;
    }
    console.error(
      `niezgodnosc wersji: VERSION.md ma ${res.version}, package.json ma ${res.packageVersion}\n` +
      'uruchom: npm run version:sync'
    );
    process.exit(1);
  }

  if (arg === '--sync') {
    const changed = sync();
    console.log(changed
      ? `package.json zaktualizowany do ${readVersion()}`
      : `package.json juz ma ${readVersion()}`);
    return;
  }

  process.stdout.write(`${readVersion()}\n`);
}

module.exports = { parseVersion, readVersion, readPackageVersion, check, sync, VERSION_FILE };

if (require.main === module) main();
