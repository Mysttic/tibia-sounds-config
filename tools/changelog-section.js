'use strict';

/**
 * Wyciaga sekcje jednej wersji z CHANGELOG.md (format Keep a Changelog).
 * Uzywane przez workflow release'owy jako tresc GitHub Release.
 *
 * Uzycie:
 *   node tools/changelog-section.js 1.2.0
 *   node tools/changelog-section.js            # wersja z package.json
 */

const fs = require('node:fs');
const path = require('node:path');

const HEADING = /^##\s+\[?([^\]\s]+)\]?/;

/**
 * @param {string} markdown tresc CHANGELOG.md
 * @param {string} version  np. "1.2.0" (bez prefiksu v)
 * @returns {string|null} tresc sekcji bez naglowka, albo null gdy brak
 */
function extractSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const wanted = version.replace(/^v/, '');
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING.exec(lines[i]);
    if (m && m[1].replace(/^v/, '') === wanted) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (HEADING.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function main() {
  const root = path.join(__dirname, '..');
  const version = process.argv[2]
    || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const file = path.join(root, 'CHANGELOG.md');

  let markdown = '';
  try {
    markdown = fs.readFileSync(file, 'utf8');
  } catch {
    process.stdout.write(`Wydanie ${version}.\n`);
    return;
  }

  const section = extractSection(markdown, version);
  if (!section) {
    process.stdout.write(`Wydanie ${version}. Brak wpisu w CHANGELOG.md.\n`);
    return;
  }
  process.stdout.write(`${section}\n`);
}

module.exports = { extractSection };

if (require.main === module) main();
