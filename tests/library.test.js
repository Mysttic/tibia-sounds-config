'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SoundLibrary, extFor, cleanName, ID_PATTERN } = require('../electron/lib/library');

async function tmpLib() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-lib-'));
  const src = path.join(root, 'zrodlo.mp3');
  await fsp.writeFile(src, Buffer.from('ID3udawany plik mp3'));
  return { root, src, lib: new SoundLibrary(path.join(root, 'generated')) };
}

// --- pomocnicze --------------------------------------------------------------

test('rozszerzenie bierze sie z typu MIME, z sensownym domyslnym', () => {
  assert.equal(extFor('audio/mpeg'), '.mp3');
  assert.equal(extFor('audio/wav'), '.wav');
  assert.equal(extFor('audio/ogg'), '.ogg');
  assert.equal(extFor('AUDIO/MPEG'), '.mp3', 'wielkosc liter nie ma znaczenia');
  assert.equal(extFor('cos/dziwnego'), '.mp3');
  assert.equal(extFor(null), '.mp3');
});

test('nazwa jest przycinana i pozbawiana lamania linii', () => {
  assert.equal(cleanName('  ryk smoka  '), 'ryk smoka');
  assert.equal(cleanName('linia\ndruga'), 'linia druga');
  assert.equal(cleanName('').length > 0, true, 'pusta nazwa dostaje zastepnik');
  assert.equal(cleanName('x'.repeat(500)).length, 80);
});

// --- dodawanie i lista -------------------------------------------------------

test('dodany dzwiek ma plik na dysku i wpis w spisie', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    const item = await lib.add({
      srcPath: src,
      contentType: 'audio/mpeg',
      prompt: 'deep dragon roar',
      origin: { providerId: 'elevenlabs' },
      size: 4096,
    });

    assert.ok(ID_PATTERN.test(item.id), 'identyfikator ma ustalony ksztalt');
    assert.equal(item.name, 'deep dragon roar', 'domyslna nazwa to opis');
    assert.equal(item.provider, 'elevenlabs');

    const plik = await lib.filePath(item.id);
    assert.ok(plik.endsWith('.mp3'));
    assert.deepEqual(await fsp.readFile(plik), await fsp.readFile(src));

    const lista = await lib.list();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].file, undefined, 'renderer nie dostaje sciezki, tylko id');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('najswiezsze wpisy sa na gorze listy', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'pierwszy' });
    await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'drugi' });
    const lista = await lib.list();
    assert.deepEqual(lista.map((i) => i.name), ['drugi', 'pierwszy']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('biblioteka przezywa ponowne wczytanie', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    const item = await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'ryk' });
    const drugi = new SoundLibrary(lib.dir);
    const lista = await drugi.list();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].id, item.id);
    assert.ok(await drugi.filePath(item.id));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// --- bariera dla protokolu ---------------------------------------------------

test('filePath oddaje sciezke tylko dla id z wlasnego spisu', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'x' });
    for (const zle of [
      '../../../etc/passwd',
      'C:\\Windows\\win.ini',
      'index.json',
      'a'.repeat(16), // poprawny ksztalt, ale nie ma go w spisie
      '',
      null,
    ]) {
      assert.equal(await lib.filePath(zle), null, `powinno odpasc: ${zle}`);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// --- zmiana nazwy i usuwanie -------------------------------------------------

test('zmiana nazwy nie rusza pliku ani opisu', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    const item = await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'deep dragon roar' });
    const przed = await lib.filePath(item.id);

    assert.equal(await lib.rename(item.id, 'Ryk smoka'), 'Ryk smoka');
    const [po] = await lib.list();
    assert.equal(po.name, 'Ryk smoka');
    assert.equal(po.prompt, 'deep dragon roar', 'opis zostaje bez zmian');
    assert.equal(await lib.filePath(item.id), przed, 'plik sie nie przenosi');

    await assert.rejects(() => lib.rename('a'.repeat(16), 'x'), /nie ma takiego dzwieku/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('pusta nowa nazwa nie kasuje starej', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    const item = await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'oryginalna' });
    assert.equal(await lib.rename(item.id, '   '), 'oryginalna');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('usuwanie kasuje wpis i plik', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    const item = await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'do usuniecia' });
    const plik = await lib.filePath(item.id);

    assert.equal(await lib.remove(item.id), true);
    assert.deepEqual(await lib.list(), []);
    assert.equal(await lib.filePath(item.id), null);
    await assert.rejects(() => fsp.access(plik), 'plik ma zniknac z dysku');

    assert.equal(await lib.remove(item.id), false, 'drugie usuniecie nic nie zmienia');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// --- rodzaje wpisow ----------------------------------------------------------

test('plik z dysku i dzwiek wygenerowany roznia sie rodzajem', async () => {
  const { root, src, lib } = await tmpLib();
  try {
    await lib.add({ srcPath: src, contentType: 'audio/mpeg', prompt: 'dragon roar' });
    await lib.add({ srcPath: src, ext: '.wav', kind: 'disk', fileName: 'moj-dzwiek.wav', size: 100 });

    const [zDysku, wygenerowany] = await lib.list();
    assert.equal(zDysku.kind, 'disk');
    assert.equal(zDysku.name, 'moj-dzwiek.wav', 'nazwa domyslna to nazwa pliku');
    assert.equal(zDysku.fileName, 'moj-dzwiek.wav');
    assert.equal(zDysku.provider, null);
    assert.ok((await lib.filePath(zDysku.id)).endsWith('.wav'), 'rozszerzenie z dysku zachowane');

    assert.equal(wygenerowany.kind, 'generated');
    assert.equal(wygenerowany.prompt, 'dragon roar');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('wpisy sprzed wprowadzenia rodzajow czytamy jako wygenerowane', async () => {
  const { root, lib } = await tmpLib();
  try {
    await fsp.mkdir(lib.dir, { recursive: true });
    await fsp.writeFile(lib.indexFile, JSON.stringify({
      items: [{ id: 'a'.repeat(16), file: 'a.mp3', name: 'stary wpis', prompt: 'cos' }],
    }));
    const [item] = await lib.list();
    assert.equal(item.kind, 'generated');
    assert.equal(item.name, 'stary wpis');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('uszkodzony spis nie wywala biblioteki', async () => {
  const { root, lib } = await tmpLib();
  try {
    await fsp.mkdir(lib.dir, { recursive: true });
    await fsp.writeFile(lib.indexFile, '{ to nie jest json');
    assert.deepEqual(await lib.list(), []);
    assert.equal(await lib.filePath('a'.repeat(16)), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
