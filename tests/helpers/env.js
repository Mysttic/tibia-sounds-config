'use strict';

const { detectFfmpeg } = require('../../electron/lib/audio');

/**
 * Czesc testow potrzebuje ffmpega (konwersja, generowanie ciszy, fixture z prawdziwym
 * audio). Reszta - parser banku, deskryptory, statusy, sciezki - dziala bez niego.
 *
 * Zamiast wywalac caly zestaw, testy zalezne od ffmpega same sie pomijaja
 * i mowia dlaczego. CI ma ffmpega zainstalowanego, wiec tam lecą wszystkie.
 */

let cached = null;

async function ffmpegStatus() {
  if (!cached) cached = await detectFfmpeg();
  return cached;
}

/** Zwraca `{ skip: '<powod>' }` albo `{}` - do przekazania jako opcje test(). */
async function needsFfmpeg() {
  const status = await ffmpegStatus();
  if (!status.available) return { skip: `ffmpeg niedostepny (${status.path})` };
  if (!status.libvorbis) return { skip: 'ffmpeg bez enkodera libvorbis' };
  return {};
}

module.exports = { ffmpegStatus, needsFfmpeg };
