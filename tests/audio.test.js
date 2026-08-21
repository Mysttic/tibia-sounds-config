'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { needsFfmpeg } = require('./helpers/env');
const {
  detectFfmpeg, probeOgg, convertToOgg, makeSilence, setFfmpegPath, getFfmpegPath, SUPPORTED_INPUT,
} = require('../electron/lib/audio');
const { makeSourceMp3 } = require('../tools/make-fixture');

let dir;
let gate;

test.before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audio-'));
  gate = await needsFfmpeg();
});
test.after(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

test('SUPPORTED_INPUT pokrywa formaty ktore uzytkownik moze podrzucic', () => {
  for (const ext of ['.mp3', '.wav', '.ogg', '.flac', '.m4a']) {
    assert.ok(SUPPORTED_INPUT.includes(ext), `brakuje ${ext}`);
  }
  assert.ok(SUPPORTED_INPUT.every((e) => e.startsWith('.')));
});

test('detectFfmpeg zwraca czytelny blad przy zlej sciezce', async () => {
  const original = getFfmpegPath();
  setFfmpegPath(path.join(os.tmpdir(), 'na-pewno-nie-ma-takiego-ffmpeg'));
  try {
    const res = await detectFfmpeg();
    assert.equal(res.available, false);
    assert.equal(res.libvorbis, false);
    assert.match(res.error, /ffmpeg/i);
  } finally {
    setFfmpegPath(original);
  }
});

test('detectFfmpeg widzi enkoder libvorbis', async (t) => {
  const g = await needsFfmpeg();
  if (g.skip) return t.skip(g.skip);
  const res = await detectFfmpeg();
  assert.equal(res.available, true);
  assert.equal(res.libvorbis, true, '-encoders wypisuje na stdout, musimy czytac oba strumienie');
});

test('probeOgg czyta kanaly, czestotliwosc i dlugosc z naglowkow', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const out = path.join(dir, 'stereo48.ogg');
  await makeSilence(out, { sampleRate: 48000, channels: 2, durationSec: 0.5 });
  const info = await probeOgg(out);
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 2);
  assert.ok(Math.abs(info.durationSec - 0.5) < 0.05, `dlugosc ${info.durationSec}`);
  assert.ok(info.size > 0);
});

test('probeOgg nie wywala sie na pliku ktory nie jest Vorbisem', async () => {
  const junk = path.join(dir, 'nie-ogg.ogg');
  await fsp.writeFile(junk, Buffer.alloc(4096, 0x5a));
  const info = await probeOgg(junk);
  assert.deepEqual(
    { channels: info.channels, sampleRate: info.sampleRate, durationSec: info.durationSec },
    { channels: 0, sampleRate: 0, durationSec: 0 }
  );
});

test('convertToOgg zachowuje sampleRate i liczbe kanalow oryginalu', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const src = await makeSourceMp3(path.join(dir, 'zrodlo.mp3'), { seconds: 0.4 });
  const out = path.join(dir, 'wynik.ogg');
  const info = await convertToOgg(src, out, { sampleRate: 48000, channels: 2, quality: 4 });
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 2);
  assert.ok(info.durationSec > 0.3);
});

test('convertToOgg czysci metadane zrodla', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const src = await makeSourceMp3(path.join(dir, 'tagi.mp3'), { seconds: 0.3 });
  const out = path.join(dir, 'bez-tagow.ogg');
  await convertToOgg(src, out, {});
  const head = await fsp.readFile(out);
  assert.ok(!head.includes(Buffer.from('TITLE=', 'ascii')), 'nie przenosimy tagow do klienta');
});

test('convertToOgg rzuca z trescia bledu ffmpega na uszkodzonym wejsciu', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const bad = path.join(dir, 'popsute.mp3');
  await fsp.writeFile(bad, Buffer.alloc(512, 0x00));
  await assert.rejects(convertToOgg(bad, path.join(dir, 'x.ogg'), {}), /ffmpeg/);
});

test('makeSilence tworzy krotki i maly plik o zadanych parametrach', async (t) => {
  if (gate.skip) return t.skip(gate.skip);
  const out = path.join(dir, 'cisza.ogg');
  const info = await makeSilence(out, { sampleRate: 44100, channels: 1, durationSec: 0.05 });
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.channels, 1);
  assert.ok(info.durationSec <= 0.08, `dlugosc ${info.durationSec}`);
  assert.ok(info.size < 8000, `rozmiar ${info.size}`);
});
