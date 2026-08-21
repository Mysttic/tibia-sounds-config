'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listGenerators, getGenerator, cleanPrompt, clamp, elevenlabs, openrouterTts, MAX_PROMPT,
} = require('../electron/lib/generate');

/**
 * Adaptery testujemy z podstawionym pobieraniem - bez ruchu w sieci, bez klucza
 * i bez obciazania czyjegokolwiek konta. Sprawdzamy to, co adapter faktycznie
 * wysyla: adres, metode, naglowki i cialo zadania.
 */

function fakeDownload(capture = {}) {
  return async (url, opts) => {
    capture.url = url;
    capture.opts = opts;
    capture.body = opts.body ? JSON.parse(opts.body) : null;
    return { path: 'C:/tmp/x/audio', dir: 'C:/tmp/x', size: 4096, contentType: 'audio/mpeg' };
  };
}

// --- pomocnicze --------------------------------------------------------------

test('cleanPrompt odrzuca pusty opis i przycina zbyt dlugi', () => {
  assert.throws(() => cleanPrompt(''), /napisz/);
  assert.throws(() => cleanPrompt('   '), /napisz/);
  assert.equal(cleanPrompt('  smok  '), 'smok');
  assert.equal(cleanPrompt('a'.repeat(MAX_PROMPT + 500)).length, MAX_PROMPT);
});

test('clamp trzyma sie zakresu i ma zapasowa wartosc', () => {
  assert.equal(clamp(5, 0, 10, 3), 5);
  assert.equal(clamp(-1, 0, 10, 3), 0);
  assert.equal(clamp(99, 0, 10, 3), 10);
  assert.equal(clamp('nie liczba', 0, 10, 3), 3);
});

// --- rejestr -----------------------------------------------------------------

test('lista generatorow nie wynosi niczego wrazliwego', () => {
  const list = listGenerators();
  assert.ok(list.length >= 2);
  for (const g of list) {
    assert.ok(g.id && g.name && g.description);
    assert.equal(g.needsKey, true, 'kazdy generator wymaga klucza uzytkownika');
    // nazwa naglowka z kluczem jest szczegolem implementacji - nie wychodzi na zewnatrz
    assert.equal(g.keyHeader, undefined);
    assert.equal(g.generate, undefined);
  }
});

test('nieznany generator jest odrzucany', () => {
  assert.throws(() => getGenerator('nie-ma-takiego'), /nieznany generator/);
  assert.equal(getGenerator('elevenlabs').id, 'elevenlabs');
});

// --- ElevenLabs --------------------------------------------------------------

test('ElevenLabs wysyla POST na endpoint efektow z kluczem w naglowku', async () => {
  const cap = {};
  const out = await elevenlabs.generate('deep dragon roar', {
    key: 'sekretny-klucz',
    download: fakeDownload(cap),
  });

  assert.equal(cap.url, 'https://api.elevenlabs.io/v1/sound-generation');
  assert.equal(cap.opts.method, 'POST');
  assert.equal(cap.opts.headers['xi-api-key'], 'sekretny-klucz');
  assert.equal(cap.opts.headers.Accept, 'audio/mpeg');
  assert.equal(cap.body.text, 'deep dragon roar');
  assert.equal(cap.body.model_id, 'eleven_text_to_sound_v2');
  assert.equal(cap.body.loop, false);
  // bez podanej dlugosci zostawiamy wybor dostawcy, zamiast zgadywac
  assert.equal('duration_seconds' in cap.body, false);

  assert.equal(out.path, 'C:/tmp/x/audio');
  assert.equal(out.origin.providerId, 'elevenlabs');
  assert.match(out.origin.attribution, /deep dragon roar/);
});

test('ElevenLabs przycina dlugosc do zakresu i przekazuje zapetlenie', async () => {
  const cap = {};
  await elevenlabs.generate('rain loop', {
    key: 'k', durationSec: 999, loop: true, influence: 5, download: fakeDownload(cap),
  });
  assert.equal(cap.body.duration_seconds, 30);
  assert.equal(cap.body.loop, true);
  assert.equal(cap.body.prompt_influence, 1);

  const cap2 = {};
  await elevenlabs.generate('krotki', { key: 'k', durationSec: 0.1, download: fakeDownload(cap2) });
  assert.equal(cap2.body.duration_seconds, 0.5);
});

test('bez klucza nie wychodzi zadne zadanie', async () => {
  let wywolan = 0;
  const licznik = async () => { wywolan += 1; return {}; };
  await assert.rejects(
    () => elevenlabs.generate('cokolwiek', { download: licznik }),
    /brak klucza API/
  );
  await assert.rejects(
    () => openrouterTts.generate('cokolwiek', { download: licznik }),
    /brak klucza API/
  );
  assert.equal(wywolan, 0);
});

test('pusty opis odpada zanim cokolwiek poleci w siec', async () => {
  let wywolan = 0;
  const licznik = async () => { wywolan += 1; return {}; };
  await assert.rejects(() => elevenlabs.generate('  ', { key: 'k', download: licznik }), /napisz/);
  assert.equal(wywolan, 0);
});

// --- OpenRouter --------------------------------------------------------------

test('OpenRouter wysyla klucz jako Bearer i prosi o mp3', async () => {
  const cap = {};
  const out = await openrouterTts.generate('A dragon lord has been sighted', {
    key: 'or-klucz', download: fakeDownload(cap),
  });

  assert.equal(cap.url, 'https://openrouter.ai/api/v1/audio/speech');
  assert.equal(cap.opts.method, 'POST');
  assert.equal(cap.opts.headers.Authorization, 'Bearer or-klucz');
  assert.equal(cap.body.input, 'A dragon lord has been sighted');
  assert.equal(cap.body.response_format, 'mp3');
  assert.equal(cap.body.model, openrouterTts.defaults.model);
  assert.equal(cap.body.voice, openrouterTts.defaults.voice);
  assert.equal(out.origin.providerId, 'openrouter-tts');
});

test('model i glos w OpenRouterze da sie zmienic', async () => {
  const cap = {};
  await openrouterTts.generate('tekst', {
    key: 'k', model: 'google/gemini-flash-tts', voice: 'kore', download: fakeDownload(cap),
  });
  assert.equal(cap.body.model, 'google/gemini-flash-tts');
  assert.equal(cap.body.voice, 'kore');
});

test('pochodzenie zapisuje sie w ksztalcie, ktorego oczekuje profil', async () => {
  const out = await elevenlabs.generate('wind', { key: 'k', download: fakeDownload() });
  for (const pole of ['providerId', 'title', 'author', 'license', 'licenseUrl', 'pageUrl', 'attribution']) {
    assert.ok(pole in out.origin, `brakuje pola ${pole}`);
  }
  // licencja zalezy od planu uzytkownika, wiec nie udajemy, ze wiemy jaka jest
  assert.match(out.origin.license, /plan|regulamin/i);
});
