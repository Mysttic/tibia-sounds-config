'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listProviders, getProvider, customProvider, normalizeResult, normalizeDuration,
  parseArchiveLength, dedupeArchiveFiles, pick, BUILTIN, ARCHIVE_COLLECTIONS,
} = require('../electron/lib/providers');
const { assertHttps, NetError } = require('../electron/lib/net');

/**
 * Testy nie ruszaja sieci - sprawdzaja logike normalizacji, mapowania i barier
 * bezpieczenstwa. Dzialanie na zywych API weryfikuje sonda e2e (docs/TESTING.md).
 */

// --- bariery sieciowe --------------------------------------------------------

test('assertHttps przepuszcza tylko https', () => {
  assert.ok(assertHttps('https://example.com/a.mp3'));
  for (const bad of [
    'http://example.com/a.mp3',
    'file:///C:/Windows/System32/calc.exe',
    'data:audio/mp3;base64,AAAA',
    'ftp://example.com/a.mp3',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => assertHttps(bad), NetError, `powinno odrzucic ${bad}`);
  }
  assert.throws(() => assertHttps('to nie jest url'), NetError);
});

// --- normalizacja ------------------------------------------------------------

test('normalizeDuration rozpoznaje sekundy i milisekundy', () => {
  assert.equal(normalizeDuration(4.6), 4.6);
  assert.equal(normalizeDuration(4600), 4.6);
  assert.equal(normalizeDuration(0), 0);
  assert.equal(normalizeDuration(null), 0);
  assert.equal(normalizeDuration('nie liczba'), 0);
  assert.equal(normalizeDuration(-5), 0);
});

test('normalizeResult ustawia komplet pol i przycina dlugie teksty', () => {
  const r = normalizeResult({
    id: 42, title: 'x'.repeat(500), author: 'y'.repeat(500),
    license: 'cc0', audioUrl: 'https://a/b.mp3', durationSec: 2500,
  }, 'test');
  assert.equal(r.providerId, 'test');
  assert.equal(r.id, '42');
  assert.equal(r.title.length, 200);
  assert.equal(r.author.length, 120);
  assert.equal(r.license, 'CC0');
  assert.equal(r.durationSec, 2.5);
  assert.equal(r.pageUrl, '');
});

test('pick czyta zagniezdzone sciezki', () => {
  const obj = { a: { b: { c: 7 } }, list: [{ v: 1 }] };
  assert.equal(pick(obj, 'a.b.c'), 7);
  assert.equal(pick(obj, 'list.0.v'), 1);
  assert.equal(pick(obj, 'a.nie.ma'), undefined);
  assert.equal(pick(obj, ''), undefined);
});

// --- Internet Archive: dedupe i czas trwania ---------------------------------

test('parseArchiveLength obsluguje sekundy i format M:SS', () => {
  assert.equal(parseArchiveLength('46.11'), 46.11);
  assert.equal(parseArchiveLength('0:46'), 46);
  assert.equal(parseArchiveLength('1:02:03'), 3723);
  assert.equal(parseArchiveLength(''), 0);
  assert.equal(parseArchiveLength(null), 0);
});

test('dedupeArchiveFiles zostawia jeden plik na nagranie, preferujac lzejszy format', () => {
  const files = [
    { name: 'G33-01-Mortar.wav' },
    { name: 'G33-01-Mortar.mp3' },
    { name: 'G33-01-Mortar.ogg' },
    { name: 'G33-02-Gun.wav' },
    { name: 'okladka.png' },
    { name: 'spectrogram.jpg' },
  ];
  const out = dedupeArchiveFiles(files).map((f) => f.name).sort();
  assert.deepEqual(out, ['G33-01-Mortar.ogg', 'G33-02-Gun.wav']);
});

// --- wbudowane zrodla --------------------------------------------------------

test('wbudowane zrodla sa oznaczone i maja opis', () => {
  assert.equal(BUILTIN.length, 2);
  for (const p of BUILTIN) {
    assert.equal(p.builtin, true);
    assert.ok(p.name && p.description && p.homepage);
    assert.equal(typeof p.search, 'function');
  }
  assert.deepEqual(BUILTIN.map((p) => p.id), ['openverse', 'archive']);
});

test('Internet Archive pyta wylacznie o kolekcje z bialej listy', () => {
  assert.deepEqual(ARCHIVE_COLLECTIONS, ['usc-sound-effect-archive', 'folksoundomy_effects']);
});

test('listProviders laczy wbudowane z wlasnymi, getProvider odnajduje po id', () => {
  const def = { id: 'moje', name: 'Moje', searchUrl: 'https://x.pl/api?q={query}' };
  const all = listProviders([def]);
  assert.equal(all.length, 3);
  assert.equal(all[2].builtin, false);
  assert.equal(getProvider('openverse').builtin, true);
  assert.equal(getProvider('moje', [def]).name, 'Moje');
  assert.throws(() => getProvider('nie-ma'), /nieznane zrodlo/);
});

test('niepoprawna definicja wlasnego zrodla nie wywala listy', () => {
  const all = listProviders([{ id: 'bez-url' }, { searchUrl: 'https://x.pl' }]);
  assert.equal(all.length, BUILTIN.length, 'zle definicje maja byc pominiete');
});

// --- adapter uzytkownika -----------------------------------------------------

test('customProvider wymaga id i searchUrl oraz https', () => {
  assert.throws(() => customProvider({ id: 'a' }), /searchUrl/);
  assert.throws(() => customProvider({ searchUrl: 'https://x.pl' }), /id/);
  assert.throws(() => customProvider({ id: 'a', searchUrl: 'http://x.pl?q={query}' }), NetError);
});

test('customProvider mapuje odpowiedz wg definicji i skleja prefiks URL', async () => {
  const def = {
    id: 'moje',
    searchUrl: 'https://przyklad.pl/api?q={query}&limit={limit}',
    resultsPath: 'data.items',
    map: { id: 'uid', title: 'name', author: 'user.nick', audioUrl: 'file', license: 'lic' },
    audioUrlPrefix: 'https://przyklad.pl/media/',
  };
  const provider = customProvider(def);

  // wstrzykujemy atrape pobierania, zeby test nie wychodzil do internetu
  let requestedUrl = null;
  const fakeFetch = async (url) => {
    requestedUrl = url;
    return {
      data: {
        items: [
          { uid: 'a1', name: 'Wybuch', user: { nick: 'ktos' }, file: 'boom.mp3', lic: 'cc0' },
          { uid: 'a2', name: 'Bez pliku', user: { nick: 'x' }, lic: 'cc0' },
          { uid: 'a3', name: 'Zly protokol', file: 'http://zle.pl/x.mp3', lic: 'cc0' },
        ],
      },
    };
  };

  const out = await provider.search('boom', { limit: 5, fetchJson: fakeFetch });

  assert.match(requestedUrl, /q=boom&limit=5/);
  assert.equal(out.results.length, 1, 'wpis bez pliku i z http maja odpasc');
  const r = out.results[0];
  assert.equal(r.title, 'Wybuch');
  assert.equal(r.author, 'ktos');
  assert.equal(r.license, 'CC0');
  assert.equal(r.audioUrl, 'https://przyklad.pl/media/boom.mp3');
  assert.equal(r.providerId, 'moje');
});

test('customProvider zglasza czytelny blad gdy resultsPath nie jest tablica', async () => {
  const provider = customProvider({
    id: 'zle', searchUrl: 'https://x.pl?q={query}', resultsPath: 'nie.ma',
  });
  await assert.rejects(
    provider.search('x', { fetchJson: async () => ({ cos: 1 }) }),
    /nie jest tablica/
  );
});
