'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * VERSION.md jest zrodlem prawdy dla numeru wersji - stad bierze go zarowno CI,
 * jak i pasek aplikacji oraz tytul okna.
 *
 * Plik jest dolaczany do paczki (electron-builder.yml, sekcja `files`), wiec
 * dziala tak samo w trybie deweloperskim i w zainstalowanej aplikacji.
 */

// Samodzielny numer w linii, ewentualnie w dekoracjach markdown: "## v1.2.3", "**1.2.3**", "- 1.2.3"
const LINE = /^[\s>#*_-]*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)[\s*_]*$/;

/**
 * @param {string} markdown tresc VERSION.md
 * @returns {string} np. "1.0.0"
 * @throws gdy w pliku nie ma numeru wersji
 */
function parseVersion(markdown) {
  for (const line of markdown.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) return m[1];
  }
  throw new Error('VERSION.md nie zawiera numeru wersji w formacie MAJOR.MINOR.PATCH');
}

function defaultVersionFile() {
  return path.join(__dirname, '..', '..', 'VERSION.md');
}

/** Wersja z VERSION.md, a gdy pliku nie ma lub jest popsuty - `fallback`. */
function resolveAppVersion(fallback = '0.0.0', file = defaultVersionFile()) {
  try {
    return parseVersion(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = { parseVersion, resolveAppVersion, defaultVersionFile, LINE };
