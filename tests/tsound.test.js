'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { PreviewStore, resolveTsound } = require('../electron/lib/tsound');

const OK_NAME = `sound-${'a'.repeat(64)}.ogg`;
const client = { soundsDir: path.join(os.tmpdir(), 'klient', 'packages', 'Tibia', 'sounds') };
const vault = { originalsDir: path.join(os.tmpdir(), 'vault', 'originals') };

const ctx = (extra = {}) => ({ client, vault, previews: new PreviewStore(), ...extra });

// --- poprawne zadania ------------------------------------------------------

test('sound i original trafiaja do wlasciwych katalogow', () => {
  const a = resolveTsound(`tsound://sound/${OK_NAME}`, ctx());
  assert.equal(a.kind, 'file');
  assert.equal(a.file, path.join(client.soundsDir, OK_NAME));

  const b = resolveTsound(`tsound://original/${OK_NAME}`, ctx());
  assert.equal(b.kind, 'file');
  assert.equal(b.file, path.join(vault.originalsDir, OK_NAME));
});

// --- bariera przed odczytem dowolnej sciezki -------------------------------

test('nazwa niepasujaca do sound-<64 hex>.ogg jest odrzucana', () => {
  const zle = [
    'sound-xyz.ogg',
    `sound-${'a'.repeat(63)}.ogg`,
    `sound-${'a'.repeat(64)}.mp3`,
    `___sound-${'a'.repeat(64)}.ogg`,
    'profile.json',
    '',
  ];
  for (const name of zle) {
    const res = resolveTsound(`tsound://sound/${name}`, ctx());
    assert.equal(res.status, 400, `powinno odpasc: ${name}`);
    assert.equal(res.file, undefined);
  }
});

test('proby wyjscia z katalogu odpadaja, takze zakodowane procentowo', () => {
  const proby = [
    'tsound://sound/..%2F..%2Fclient.exe',
    'tsound://sound/%2E%2E%2Fprofile.json',
    `tsound://sound/%2E%2E%2F${OK_NAME}`,
    `tsound://sound/podkatalog%2F${OK_NAME}`,
    `tsound://sound/..%5C${OK_NAME}`,
    `tsound://original/%2E%2E%2F%2E%2E%2F${OK_NAME}`,
  ];
  for (const url of proby) {
    const res = resolveTsound(url, ctx());
    assert.equal(res.status, 400, `powinno odpasc: ${url}`);
    assert.equal(res.file, undefined);
  }
});

test('sciezka bezwzgledna w miejscu nazwy nie przechodzi', () => {
  const res = resolveTsound('tsound://sound/C%3A%5CWindows%5Cwin.ini', ctx());
  assert.equal(res.status, 400);
});

test('niepoprawne kodowanie procentowe nie wywala handlera', () => {
  const res = resolveTsound('tsound://sound/%zz', ctx());
  assert.equal(res.status, 400);
});

test('niepoprawny adres nie wywala handlera', () => {
  assert.equal(resolveTsound('to nie jest url', ctx()).status, 400);
});

// --- stan aplikacji --------------------------------------------------------

test('bez wybranego klienta nie ma czego czytac', () => {
  const res = resolveTsound(`tsound://sound/${OK_NAME}`, ctx({ client: null, vault: null }));
  assert.equal(res.status, 409);
});

test('nieznany rodzaj zasobu to 404', () => {
  assert.equal(resolveTsound(`tsound://cokolwiek/${OK_NAME}`, ctx()).status, 404);
});

test('kolejnosc sprawdzen: zla nazwa odpada takze bez klienta', () => {
  const res = resolveTsound('tsound://sound/../../x', ctx({ client: null, vault: null }));
  assert.equal(res.file, undefined);
  assert.ok(res.status === 400 || res.status === 409);
});

// --- podglady z sieci ------------------------------------------------------

test('podglad dziala tylko dla zapamietanego klucza', () => {
  const previews = new PreviewStore();
  previews.remember('https://example.org/a.ogg', 'klucz1');

  const ok = resolveTsound('tsound://preview/klucz1', ctx({ previews }));
  assert.equal(ok.kind, 'preview');
  assert.equal(ok.url, 'https://example.org/a.ogg');

  assert.equal(resolveTsound('tsound://preview/klucz2', ctx({ previews })).status, 404);
});

test('renderer nie moze podac dowolnego adresu jako klucza', () => {
  const previews = new PreviewStore();
  const res = resolveTsound('tsound://preview/https%3A%2F%2Fzle.pl%2Fx.ogg', ctx({ previews }));
  assert.equal(res.status, 404);
  assert.equal(res.url, undefined);
});

// --- biblioteka wygenerowanych ----------------------------------------------

test('wpis biblioteki wraca jako id do rozwiazania, nie jako sciezka', () => {
  const res = resolveTsound(`tsound://library/${'a'.repeat(16)}`, ctx());
  assert.equal(res.kind, 'library');
  assert.equal(res.id, 'a'.repeat(16));
  // sciezki nie ustalamy tutaj - robi to biblioteka na podstawie wlasnego spisu
  assert.equal(res.file, undefined);
});

test('renderer nie podstawi wlasnej sciezki jako identyfikatora', () => {
  for (const url of [
    'tsound://library/C%3A%5CWindows%5Cwin.ini',
    'tsound://library/..%2F..%2Fclient.exe',
    'tsound://library/%2Fetc%2Fpasswd',
    `tsound://library/${'a'.repeat(15)}`,
    `tsound://library/${'a'.repeat(17)}`,
    'tsound://library/ZZZZZZZZZZZZZZZZ',
    'tsound://library/',
  ]) {
    const res = resolveTsound(url, ctx());
    assert.equal(res.status, 400, `powinno odpasc: ${url}`);
    assert.equal(res.id, undefined);
  }
});

// --- PreviewStore ----------------------------------------------------------

test('PreviewStore nie rosnie bez konca i wyrzuca najstarsze wpisy', () => {
  const store = new PreviewStore(3);
  for (let i = 0; i < 5; i += 1) store.remember(`https://example.org/${i}.ogg`, `k${i}`);

  assert.equal(store.size, 3);
  assert.equal(store.get('k0'), null, 'najstarszy wpis powinien wypasc');
  assert.equal(store.get('k1'), null);
  assert.equal(store.get('k4'), 'https://example.org/4.ogg');
});

test('ponowne zapamietanie odswieza wpis zamiast go dublowac', () => {
  const store = new PreviewStore(2);
  store.remember('https://example.org/a.ogg', 'a');
  store.remember('https://example.org/b.ogg', 'b');
  store.remember('https://example.org/a.ogg', 'a'); // a znow najswiezsze
  store.remember('https://example.org/c.ogg', 'c'); // wypada b, nie a

  assert.equal(store.size, 2);
  assert.equal(store.get('a'), 'https://example.org/a.ogg');
  assert.equal(store.get('b'), null);
  assert.equal(store.get('c'), 'https://example.org/c.ogg');
});
