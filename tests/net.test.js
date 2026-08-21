'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  assertHttps, fetchJson, downloadToTemp, NetError, MAX_DOWNLOAD_BYTES,
} = require('../electron/lib/net');

/**
 * Warstwa sieciowa jest jedynym miejscem, przez ktore aplikacja wychodzi na zewnatrz.
 * Testujemy ja z podstawionym `fetch` - bez ruchu w sieci i bez zaleznosci od tego,
 * czy akurat dziala Openverse.
 */

const PRAWDZIWY_FETCH = globalThis.fetch;

function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return impl(String(url), opts);
  };
  return calls;
}

test.afterEach(() => { globalThis.fetch = PRAWDZIWY_FETCH; });

function streamOf(chunks) {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}

async function tempDirCount() {
  const entries = await fsp.readdir(os.tmpdir()).catch(() => []);
  return entries.filter((e) => e.startsWith('tsc-dl-')).length;
}

// --- assertHttps -----------------------------------------------------------

test('assertHttps przepuszcza wylacznie https', () => {
  assert.equal(assertHttps('https://example.org/a.ogg').protocol, 'https:');

  const zle = [
    'http://example.org/a.ogg',
    'file:///C:/Windows/win.ini',
    'data:audio/ogg;base64,AAAA',
    'ftp://example.org/a.ogg',
    'javascript:alert(1)',
    'tsound://sound/a.ogg',
  ];
  for (const url of zle) {
    assert.throws(() => assertHttps(url), NetError, `powinno odpasc: ${url}`);
  }
});

test('assertHttps odrzuca smieci zamiast adresu', () => {
  for (const url of ['', 'example.org/a.ogg', '//example.org/a.ogg', null]) {
    assert.throws(() => assertHttps(url), /niepoprawny adres/);
  }
});

// --- downloadToTemp --------------------------------------------------------

test('pobieranie zapisuje plik i zwraca rozmiar oraz typ', async () => {
  const dane = Buffer.from('OggS-udawany-plik-audio');
  stubFetch(async () => new Response(streamOf([dane]), {
    headers: { 'content-type': 'audio/ogg; charset=binary' },
  }));

  const dl = await downloadToTemp('https://example.org/a.ogg');
  try {
    assert.equal(dl.size, dane.length);
    assert.equal(dl.contentType, 'audio/ogg');
    assert.deepEqual(await fsp.readFile(dl.path), dane);
    assert.equal(path.dirname(dl.path), dl.dir);
  } finally {
    await fsp.rm(dl.dir, { recursive: true, force: true });
  }
});

test('adres inny niz https nie dociera nawet do fetcha', async () => {
  const calls = stubFetch(async () => new Response('nigdy'));
  await assert.rejects(() => downloadToTemp('http://example.org/a.ogg'), NetError);
  assert.equal(calls.length, 0, 'zadne polaczenie nie powinno wyjsc');
});

test('odpowiedz bledna zatrzymuje pobieranie', async () => {
  stubFetch(async () => new Response('nie ma', { status: 404, statusText: 'Not Found' }));
  await assert.rejects(() => downloadToTemp('https://example.org/a.ogg'), /404/);
});

test('zadeklarowany rozmiar ponad limit odrzucamy przed pobraniem', async () => {
  const calls = stubFetch(async () => new Response(streamOf([Buffer.from('x')]), {
    headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) },
  }));

  await assert.rejects(() => downloadToTemp('https://example.org/duzy.ogg'), /limit/);
  assert.equal(calls.length, 1);
});

test('klamliwy Content-Length nie omija limitu - liczymy bajty w locie', async () => {
  // naglowek mowi 10 bajtow, a strumien sypie 40 KB
  const chunk = Buffer.alloc(4096, 7);
  stubFetch(async () => new Response(streamOf(Array.from({ length: 10 }, () => chunk)), {
    headers: { 'content-length': '10' },
  }));

  const przed = await tempDirCount();
  await assert.rejects(
    () => downloadToTemp('https://example.org/klamca.ogg', { maxBytes: 8192 }),
    /przekroczyl limit/
  );
  assert.equal(await tempDirCount(), przed, 'katalog tymczasowy musi zostac posprzatany');
});

test('przekroczony czas oczekiwania ma czytelny komunikat', async () => {
  stubFetch(async () => {
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    throw err;
  });
  await assert.rejects(() => downloadToTemp('https://example.org/a.ogg'), /przekroczono limit/);
});

test('blad sieci nie wycieka jako surowy wyjatek', async () => {
  stubFetch(async () => { throw new Error('ENOTFOUND'); });
  await assert.rejects(() => downloadToTemp('https://example.org/a.ogg'), NetError);
});

// --- fetchJson -------------------------------------------------------------

test('fetchJson zwraca sparsowana odpowiedz i wysyla wlasny User-Agent', async () => {
  const calls = stubFetch(async () => new Response(JSON.stringify({ results: [1, 2] })));
  const data = await fetchJson('https://api.example.org/szukaj');

  assert.deepEqual(data, { results: [1, 2] });
  assert.match(calls[0].opts.headers['User-Agent'], /tibia-sounds-config/);
});

test('fetchJson mowi wprost, gdy zrodlo odpowiedzialo bledem albo nie-JSON-em', async () => {
  stubFetch(async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }));
  await assert.rejects(() => fetchJson('https://api.example.org/x'), /503/);

  stubFetch(async () => new Response('<html>ups</html>'));
  await assert.rejects(() => fetchJson('https://api.example.org/x'), /nie jest poprawnym JSON/);
});
