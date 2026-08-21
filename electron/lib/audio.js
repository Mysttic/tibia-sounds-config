'use strict';

const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

/**
 * Praca z plikami audio: odczyt parametrow .ogg bez ffprobe + konwersja przez ffmpeg.
 */

const OGGS = Buffer.from('OggS', 'ascii');
const VORBIS_ID = Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // \x01vorbis

let ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

function setFfmpegPath(p) {
  ffmpegPath = p || 'ffmpeg';
}

function getFfmpegPath() {
  return ffmpegPath;
}

/**
 * Uruchamia ffmpeg, zwraca polaczone stdout+stderr.
 * Uwaga: listy typu `-encoders` ffmpeg wypisuje na stdout, a logi konwersji na stderr,
 * wiec zbieramy oba strumienie.
 */
function runFfmpeg(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ffmpeg przekroczyl limit ${timeoutMs} ms`));
    }, timeoutMs);
    const collect = (d) => {
      stderr += d.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`nie udalo sie uruchomic ffmpeg (${ffmpegPath}): ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg zakonczyl sie kodem ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

/** Sprawdza czy ffmpeg jest dostepny i czy ma enkoder libvorbis. */
async function detectFfmpeg() {
  try {
    const out = await runFfmpeg(['-hide_banner', '-encoders'], { timeoutMs: 20_000 });
    return { available: true, libvorbis: /\blibvorbis\b/.test(out), path: ffmpegPath };
  } catch (err) {
    return { available: false, libvorbis: false, path: ffmpegPath, error: err.message };
  }
}

/**
 * Czyta parametry .ogg/Vorbis wprost z naglowkow.
 * Zwraca { channels, sampleRate, durationSec } - durationSec z granule pos ostatniej strony.
 */
async function probeOgg(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(8192, size));
    await handle.read(head, 0, head.length, 0);

    const idAt = head.indexOf(VORBIS_ID);
    if (idAt < 0) return { channels: 0, sampleRate: 0, durationSec: 0, size };
    // identification header: [7B magic][4B version][1B channels][4B rate]
    const channels = head[idAt + 11];
    const sampleRate = head.readUInt32LE(idAt + 12);

    const tailLen = Math.min(65536, size);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);
    const pageAt = tail.lastIndexOf(OGGS);
    let durationSec = 0;
    if (pageAt >= 0 && sampleRate > 0) {
      const granule = tail.readBigInt64LE(pageAt + 6);
      if (granule > 0n) durationSec = Number(granule) / sampleRate;
    }
    return { channels, sampleRate, durationSec, size };
  } finally {
    await handle.close();
  }
}

function channelLayout(channels) {
  return channels >= 2 ? 'stereo' : 'mono';
}

/**
 * Konwertuje dowolne zrodlo (mp3/wav/flac/m4a/ogg) na Vorbis .ogg.
 * Domyslnie dopasowuje sampleRate i liczbe kanalow do oryginalnego dzwieku klienta,
 * zeby podmianka brzmiala w silniku tak samo jak to co zastapila.
 */
async function convertToOgg(src, dest, { sampleRate, channels, quality = 5 } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', '-map_metadata', '-1'];
  if (sampleRate) args.push('-ar', String(sampleRate));
  if (channels) args.push('-ac', String(channels));
  args.push('-c:a', 'libvorbis', '-q:a', String(quality), dest);
  await runFfmpeg(args);
  return probeOgg(dest);
}

/** Generuje krotki plik ciszy - uzywany do "wyciszenia" pojedynczego dzwieku. */
async function makeSilence(dest, { sampleRate = 44100, channels = 1, durationSec = 0.05 } = {}) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `anullsrc=r=${sampleRate}:cl=${channelLayout(channels)}`,
    '-t', String(durationSec),
    '-c:a', 'libvorbis', '-q:a', '0',
    dest,
  ];
  await runFfmpeg(args);
  return probeOgg(dest);
}

const SUPPORTED_INPUT = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.wma'];

module.exports = {
  detectFfmpeg,
  probeOgg,
  convertToOgg,
  makeSilence,
  runFfmpeg,
  setFfmpegPath,
  getFfmpegPath,
  SUPPORTED_INPUT,
};
