'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractSection } = require('../tools/changelog-section');

const SAMPLE = `# Changelog

## [Unreleased]

### Dodane
- cos w toku

## [1.2.0] - 2026-01-05

### Dodane
- pierwsza rzecz
- druga rzecz

### Naprawione
- jakis blad

## [1.1.0] - 2025-12-01

- stare wydanie
`;

test('wyciaga sekcje konkretnej wersji bez naglowka', () => {
  const out = extractSection(SAMPLE, '1.2.0');
  assert.ok(out.startsWith('### Dodane'));
  assert.ok(out.includes('pierwsza rzecz'));
  assert.ok(out.includes('jakis blad'));
  assert.ok(!out.includes('1.1.0'), 'nie moze wciagnac nastepnej sekcji');
  assert.ok(!out.includes('stare wydanie'));
});

test('prefiks v jest ignorowany po obu stronach', () => {
  assert.equal(extractSection(SAMPLE, 'v1.2.0'), extractSection(SAMPLE, '1.2.0'));
});

test('ostatnia sekcja w pliku konczy sie na koncu pliku', () => {
  const out = extractSection(SAMPLE, '1.1.0');
  assert.equal(out, '- stare wydanie');
});

test('zwraca null dla nieznanej wersji', () => {
  assert.equal(extractSection(SAMPLE, '9.9.9'), null);
});

test('Unreleased tez da sie wyciagnac', () => {
  assert.ok(extractSection(SAMPLE, 'Unreleased').includes('cos w toku'));
});

test('CHANGELOG.md w repo ma sekcje dla wersji z package.json', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = extractSection(changelog, pkg.version);
  assert.ok(section, `brak sekcji ## [${pkg.version}] w CHANGELOG.md`);
  assert.ok(section.length > 40, 'sekcja wydania nie moze byc pusta');
});
