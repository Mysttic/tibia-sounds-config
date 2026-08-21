'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Biblioteka wlasnych dzwiekow uzytkownika.
 *
 * Trafia tu wszystko, co uzytkownik sam wniosl: dzwieki wygenerowane (`kind: 'generated'`)
 * i pliki wskazane z dysku (`kind: 'disk'`). Dzieki temu raz uzyty plik da sie wgrac
 * pod kolejny wpis bez szukania go ponownie w systemie.
 *
 * Trzymamy plik DOKLADNIE taki, jaki dostalismy - od dostawcy albo z dysku - a nie
 * wersje przekonwertowana. Powod: konwersja do formatu gry zalezy od dzwieku, ktory
 * podmieniamy, bo kazdy ma wlasny sampleRate i liczbe kanalow. Gdybysmy zapisali
 * gotowy ogg, ten sam dzwiek nie dalby sie poprawnie uzyc pod inny wpis.
 * Konwertujemy wiec przy kazdym uzyciu, zawsze z oryginalu.
 *
 * Biblioteka jest niezalezna od klienta - przezywa zmiane wersji Tibii
 * i przeniesienie na inna instalacje.
 *
 *   generated/
 *     index.json          spis wpisow
 *     <id>.mp3            plik zrodlowy
 */

const FORMAT = 'tibia-sounds-config/library';
const VERSION = 1;
const MAX_NAME = 80;

/** Rozszerzenie z typu MIME - potrzebne, bo odtwarzacz rozpoznaje format po nazwie. */
const EXT_BY_TYPE = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/flac': '.flac',
};

function extFor(contentType) {
  return EXT_BY_TYPE[String(contentType || '').toLowerCase()] || '.mp3';
}

function cleanName(value, fallback = 'wygenerowany dzwiek') {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  return (text || fallback).slice(0, MAX_NAME);
}

/** Identyfikator jest nasza wlasna losowa wartoscia, nigdy nie pochodzi z zewnatrz. */
const ID_PATTERN = /^[0-9a-f]{16}$/;

class SoundLibrary {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
    this.data = null;
  }

  async load() {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await fsp.readFile(this.indexFile, 'utf8'));
      this.data = Array.isArray(raw.items) ? raw : { format: FORMAT, version: VERSION, items: [] };
    } catch {
      this.data = { format: FORMAT, version: VERSION, items: [] };
    }
    return this.data;
  }

  async save() {
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.indexFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fsp.rename(tmp, this.indexFile);
  }

  /** Sciezka pliku wpisu. Zwraca null dla nieznanego id - to jest bariera dla protokolu. */
  async filePath(id) {
    if (!ID_PATTERN.test(String(id || ''))) return null;
    const data = await this.load();
    const item = data.items.find((i) => i.id === id);
    return item ? path.join(this.dir, item.file) : null;
  }

  /** Kopiuje plik do biblioteki i dopisuje wpis. */
  async add({
    srcPath, contentType, ext = null, kind = 'generated', name, prompt = '', fileName = '',
    origin = null, durationSec = null, size = 0,
  }) {
    const data = await this.load();
    const id = crypto.randomBytes(8).toString('hex');
    const file = `${id}${ext || extFor(contentType)}`;

    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.copyFile(srcPath, path.join(this.dir, file));

    const item = {
      id,
      file,
      kind,
      name: cleanName(name || prompt || fileName),
      prompt: String(prompt || '').slice(0, 500),
      fileName: String(fileName || '').slice(0, 200),
      provider: (origin && origin.providerId) || null,
      origin,
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
      size: size || 0,
      createdAt: new Date().toISOString(),
    };
    data.items.unshift(item); // najswiezsze na gorze
    await this.save();
    return item;
  }

  /**
   * Lista bez pola `file` - renderer operuje wylacznie identyfikatorami.
   * Wpisy sprzed wprowadzenia rodzajow traktujemy jak wygenerowane.
   */
  async list() {
    const data = await this.load();
    return data.items.map(({ file, ...rest }) => ({ kind: 'generated', ...rest }));
  }

  async rename(id, name) {
    const data = await this.load();
    const item = data.items.find((i) => i.id === id);
    if (!item) throw new Error('nie ma takiego dzwieku w bibliotece');
    item.name = cleanName(name, item.name);
    await this.save();
    return item.name;
  }

  async remove(id) {
    const data = await this.load();
    const at = data.items.findIndex((i) => i.id === id);
    if (at < 0) return false;
    const [item] = data.items.splice(at, 1);
    await this.save();
    // Plik kasujemy po zapisaniu spisu - gdyby to sie nie udalo, zostaje sierota
    // na dysku, a nie wpis wskazujacy na nieistniejacy plik.
    await fsp.rm(path.join(this.dir, item.file), { force: true }).catch(() => {});
    return true;
  }
}

module.exports = { SoundLibrary, extFor, cleanName, FORMAT, VERSION, MAX_NAME, ID_PATTERN };
