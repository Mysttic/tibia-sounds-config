'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { createRawFixture } = require('../tools/make-fixture');
const { validateClientDir, candidateRoots, REL_SOUNDS } = require('../electron/lib/clientPaths');

let fixture;

test.before(async () => { fixture = await createRawFixture(); });
test.after(async () => { await fixture.cleanup(); });

test('rozpoznaje klienta po katalogu glownym', async () => {
  const res = await validateClientDir(fixture.root);
  assert.equal(res.ok, true);
  assert.equal(res.root, fixture.root);
  assert.equal(res.soundsDir, fixture.soundsDir);
  assert.equal(res.version, '0.0.0-fixture');
});

test('jest wyrozumialy: przyjmuje wskazanie packages/Tibia/sounds', async () => {
  const res = await validateClientDir(fixture.soundsDir);
  assert.equal(res.ok, true);
  assert.equal(res.root, fixture.root);
});

test('jest wyrozumialy: przyjmuje wskazanie packages/Tibia', async () => {
  const res = await validateClientDir(path.join(fixture.root, 'packages', 'Tibia'));
  assert.equal(res.ok, true);
  assert.equal(res.root, fixture.root);
});

test('odrzuca katalog bez catalog-sound.json i mowi czego brakuje', async () => {
  const res = await validateClientDir(os.tmpdir());
  assert.equal(res.ok, false);
  assert.match(res.reason, /catalog-sound\.json/);
  assert.ok(res.reason.includes(REL_SOUNDS.split(path.sep)[0]));
});

test('odrzuca pusta sciezke', async () => {
  const res = await validateClientDir('');
  assert.equal(res.ok, false);
  assert.match(res.reason, /nie podano/);
});

test('clientExe jest null gdy nie ma bin/client.exe', async () => {
  const res = await validateClientDir(fixture.root);
  assert.equal(res.clientExe, null);
});

test('clientExe wskazuje plik gdy istnieje', async () => {
  const binDir = path.join(fixture.root, 'packages', 'Tibia', 'bin');
  const exeName = process.platform === 'win32' ? 'client.exe' : 'client';
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(path.join(binDir, exeName), Buffer.alloc(16));
  try {
    const res = await validateClientDir(fixture.root);
    assert.equal(res.clientExe, path.join(binDir, exeName));
  } finally {
    await fsp.rm(binDir, { recursive: true, force: true });
  }
});

test('brak packages/Tibia/package.json nie blokuje wykrycia, tylko wersja jest null', async () => {
  const manifest = path.join(fixture.root, 'packages', 'Tibia', 'package.json');
  const backup = await fsp.readFile(manifest);
  await fsp.rm(manifest);
  try {
    const res = await validateClientDir(fixture.root);
    assert.equal(res.ok, true);
    assert.equal(res.version, null);
  } finally {
    await fsp.writeFile(manifest, backup);
  }
});

test('candidateRoots zwraca sciezki wlasciwe dla platformy', () => {
  const roots = candidateRoots();
  assert.ok(roots.length > 0);
  assert.ok(roots.every((p) => path.isAbsolute(p)));
  if (process.platform === 'win32') {
    assert.ok(roots.some((p) => /AppData[\\/]Local[\\/]Tibia$/i.test(p)));
  } else {
    assert.ok(roots.some((p) => p.includes('Tibia')));
  }
});
