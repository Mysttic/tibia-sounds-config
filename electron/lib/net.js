'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

/**
 * Warstwa sieciowa. Caly ruch wychodzacy aplikacji przechodzi tylko tedy,
 * wylacznie z procesu glownego i wylacznie na zadanie uzytkownika.
 *
 * Zasady, ktore sa tu wymuszone twardo:
 *  - tylko https (zadnego http, file, data)
 *  - limit rozmiaru pobieranego pliku
 *  - limit czasu
 *  - opisowy User-Agent (Wikimedia i Internet Archive tego wymagaja, inni to doceniaja)
 */

const USER_AGENT = 'tibia-sounds-config (+https://github.com/Mysttic/tibia-sounds-config)';
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

class NetError extends Error {}

/** Rzuca, gdy URL nie jest bezpiecznym adresem https. */
function assertHttps(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new NetError(`niepoprawny adres: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new NetError(`dozwolone sa tylko adresy https (dostalem ${parsed.protocol}//)`);
  }
  return parsed;
}

async function fetchWithTimeout(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null,
} = {}) {
  assertHttps(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      body,
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, ...headers },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new NetError(`przekroczono limit ${timeoutMs} ms: ${url}`);
    throw new NetError(`blad sieci: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** GET zwracajacy JSON. */
async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new NetError(`zrodlo odpowiedzialo ${res.status} ${res.statusText}`);
  try {
    return await res.json();
  } catch {
    throw new NetError('odpowiedz nie jest poprawnym JSON-em');
  }
}

/**
 * Pobiera plik do katalogu tymczasowego. Zwraca { path, dir, size, contentType }.
 * Przerywa, gdy plik przekroczy limit - nie ufamy naglowkowi Content-Length.
 *
 * `method`, `headers` i `body` sa potrzebne generatorom dzwiekow: tam odpowiedzia
 * na POST z promptem jest strumien audio, a nie JSON.
 */
async function downloadToTemp(url, {
  maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 60_000, method = 'GET', headers = {}, body = null,
} = {}) {
  const res = await fetchWithTimeout(url, { timeoutMs, method, headers, body });
  if (!res.ok) {
    // Tresc bledu bywa jedyna informacja, dlaczego dostawca odmowil (zly klucz,
    // wyczerpany limit) - przekazujemy ja dalej, przycieta do rozsadnej dlugosci.
    let detail = '';
    try {
      detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 300);
    } catch {
      // cialo bledu nie zawsze da sie odczytac - wtedy zostaje sam status
    }
    throw new NetError(
      `pobieranie nie powiodlo sie: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`
    );
  }

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    throw new NetError(`plik ma ${Math.round(declared / 1048576)} MB, limit to ${Math.round(maxBytes / 1048576)} MB`);
  }

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-dl-'));
  const dest = path.join(dir, `download-${crypto.randomBytes(4).toString('hex')}`);

  let received = 0;
  const counter = new (require('node:stream').Transform)({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) {
        cb(new NetError(`plik przekroczyl limit ${Math.round(maxBytes / 1048576)} MB`));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest));
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw err instanceof NetError ? err : new NetError(`blad zapisu pobranego pliku: ${err.message}`);
  }

  return {
    path: dest,
    dir,
    size: received,
    contentType: (res.headers.get('content-type') || '').split(';')[0].trim(),
  };
}

module.exports = {
  USER_AGENT,
  MAX_DOWNLOAD_BYTES,
  NetError,
  assertHttps,
  fetchJson,
  fetchWithTimeout,
  downloadToTemp,
};
