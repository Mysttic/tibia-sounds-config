'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { parseVersion, resolveAppVersion, defaultVersionFile } = require('../electron/lib/version');
const { readVersion, readPackageVersion, check } = require('../tools/version');

test('parseVersion czyta numer mimo dekoracji markdown', () => {
  assert.equal(parseVersion('# Wersja\n\n1.0.0\n'), '1.0.0');
  assert.equal(parseVersion('## v2.10.3'), '2.10.3');
  assert.equal(parseVersion('**0.4.1**'), '0.4.1');
  assert.equal(parseVersion('- 1.2.3'), '1.2.3');
  assert.equal(parseVersion('> 1.2.3'), '1.2.3');
});

test('parseVersion obsluguje sufiksy prerelease', () => {
  assert.equal(parseVersion('1.0.0-rc.1'), '1.0.0-rc.1');
  assert.equal(parseVersion('# Wersja\n\nv2.0.0-beta.3\n'), '2.0.0-beta.3');
});

test('parseVersion bierze pierwszy numer, ignoruje pozniejszy tekst', () => {
  const md = '# Wersja\n\n1.4.0\n\n---\n\nHistoria: kiedys bylo 1.3.0, a jeszcze wczesniej 1.2.0.\n';
  assert.equal(parseVersion(md), '1.4.0');
});

test('parseVersion nie lapie numeru wtopionego w zdanie', () => {
  const md = '# Wersja\n\nAplikacja wymaga Node 20.11.0 albo nowszego.\n\n3.1.0\n';
  assert.equal(parseVersion(md), '3.1.0');
});

test('parseVersion rzuca gdy nie ma numeru', () => {
  assert.throws(() => parseVersion('# Wersja\n\nbrak\n'), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseVersion(''), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseVersion('1.0\n'), /MAJOR\.MINOR\.PATCH/);
});

test('resolveAppVersion czyta plik, a przy jego braku oddaje fallback', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ver-'));
  try {
    const file = path.join(dir, 'VERSION.md');
    await fsp.writeFile(file, '# Wersja\n\n7.8.9\n');
    assert.equal(resolveAppVersion('0.0.0', file), '7.8.9');
    assert.equal(resolveAppVersion('0.0.0', path.join(dir, 'nie-ma.md')), '0.0.0');
    await fsp.writeFile(file, 'bez numeru');
    assert.equal(resolveAppVersion('1.2.3', file), '1.2.3', 'popsuty plik nie moze wywalic aplikacji');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('VERSION.md w repo jest czytelny i zgodny z package.json', () => {
  const version = readVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.equal(version, readPackageVersion(), 'uruchom: npm run version:sync');

  const res = check();
  assert.equal(res.ok, true);
  assert.equal(res.version, res.packageVersion);
});

test('resolveAppVersion domyslnie trafia w VERSION.md z repo', () => {
  assert.ok(fs.existsSync(defaultVersionFile()));
  assert.equal(resolveAppVersion('0.0.0'), readVersion());
});

test('CHANGELOG.md ma sekcje dla wersji z VERSION.md', () => {
  const { extractSection } = require('../tools/changelog-section');
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  assert.ok(extractSection(changelog, readVersion()), `brak sekcji ## [${readVersion()}]`);
});
