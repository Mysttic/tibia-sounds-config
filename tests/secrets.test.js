'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SecretStore } = require('../electron/lib/secrets');

/**
 * safeStorage Electrona nie dziala poza uruchomiona aplikacja, wiec backend
 * szyfrujacy jest wstrzykiwany. Testujemy to, co nalezy do nas: ksztalt pliku,
 * odmowe zapisu bez szyfrowania i to, ze klucz nigdy nie trafia na dysk jawnie.
 */

function fakeBackend({ available = true } = {}) {
  return {
    available: () => available,
    // "szyfrowanie" na potrzeby testu: odwrocenie bajtow z prefiksem
    encrypt: (text) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(text, 'utf8').reverse()]),
    decrypt: (buf) => {
      const raw = Buffer.from(buf);
      if (raw.subarray(0, 4).toString() !== 'ENC:') throw new Error('zly format');
      return Buffer.from(raw.subarray(4)).reverse().toString('utf8');
    },
  };
}

async function tmpFile() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-sec-'));
  return { dir, file: path.join(dir, 'secrets.json') };
}

test('zapis i odczyt klucza przechodzi przez szyfrowanie', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new SecretStore(file, fakeBackend());
    assert.equal(await store.has('elevenlabs'), false);

    await store.set('elevenlabs', 'sk-tajny-klucz-123');
    assert.equal(await store.has('elevenlabs'), true);
    assert.equal(await store.get('elevenlabs'), 'sk-tajny-klucz-123');

    // najwazniejsze: jawnego klucza nie ma nigdzie w pliku
    const surowy = await fsp.readFile(file, 'utf8');
    assert.equal(surowy.includes('sk-tajny-klucz-123'), false);
    assert.ok(surowy.includes('elevenlabs'), 'identyfikator dostawcy moze byc jawny');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('bez dostepnego szyfrowania odmawiamy zapisu zamiast pisac jawnie', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new SecretStore(file, fakeBackend({ available: false }));
    await assert.rejects(() => store.set('elevenlabs', 'jawny'), /nie zapisze klucza/);
    assert.equal(await store.has('elevenlabs'), false);
    await assert.rejects(() => fsp.access(file), 'plik nie powinien powstac');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('pusty klucz jest odrzucany', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new SecretStore(file, fakeBackend());
    await assert.rejects(() => store.set('x', '   '), /pusty klucz/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('klucz przezywa ponowne wczytanie pliku', async () => {
  const { dir, file } = await tmpFile();
  try {
    await new SecretStore(file, fakeBackend()).set('openrouter-tts', 'or-abc');
    const drugi = new SecretStore(file, fakeBackend());
    assert.equal(await drugi.get('openrouter-tts'), 'or-abc');
    assert.deepEqual(await drugi.list(), ['openrouter-tts']);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('usuniecie klucza czysci wpis', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new SecretStore(file, fakeBackend());
    await store.set('a', 'jeden');
    await store.set('b', 'dwa');
    assert.equal(await store.clear('a'), true);
    assert.equal(await store.clear('a'), false, 'drugie usuniecie nic nie zmienia');
    assert.deepEqual(await store.list(), ['b']);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('uszkodzony plik nie wywala aplikacji, tylko daje pusty zbior', async () => {
  const { dir, file } = await tmpFile();
  try {
    await fsp.writeFile(file, '{ to nie jest json');
    const store = new SecretStore(file, fakeBackend());
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.get('cokolwiek'), null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('klucz zaszyfrowany na innym koncie zwraca null, a nie wyjatek', async () => {
  const { dir, file } = await tmpFile();
  try {
    await new SecretStore(file, fakeBackend()).set('a', 'jeden');
    // inny backend nie potrafi odszyfrowac - tak wyglada przeniesienie profilu
    const obcy = {
      available: () => true,
      encrypt: (t) => Buffer.from(t),
      decrypt: () => { throw new Error('nie moje dane'); },
    };
    assert.equal(await new SecretStore(file, obcy).get('a'), null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
