'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Klucze API dostawcow generowania dzwieku.
 *
 * Zasady, ktore sa tu wymuszone twardo:
 *  - klucz nigdy nie lezy jawnie na dysku; szyfruje go safeStorage Electrona
 *    (na Windows opiera sie o DPAPI, czyli klucz konta uzytkownika systemu),
 *  - gdy szyfrowanie jest niedostepne, ODMAWIAMY zapisu zamiast zapisac jawnie,
 *  - klucz nigdy nie opuszcza procesu glownego; renderer moze co najwyzej
 *    zapytac, czy klucz jest ustawiony (`has`), i nigdy go nie dostaje.
 *
 * Plik jest osobny od settings.json, ktory jest jawny i zapisywany przy kazdej
 * zmianie geometrii okna.
 */

const FORMAT = 'tibia-sounds-config/secrets';
const VERSION = 1;

/** Domyslny backend szyfrujacy. Wydzielony, zeby dalo sie testowac bez Electrona. */
function safeStorageBackend() {
  const { safeStorage } = require('electron');
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buf) => safeStorage.decryptString(buf),
  };
}

class SecretStore {
  constructor(file, backend = null) {
    this.file = file;
    this._backend = backend;
    this.data = null;
  }

  get backend() {
    if (!this._backend) this._backend = safeStorageBackend();
    return this._backend;
  }

  async load() {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      this.data = raw && raw.keys ? raw : { format: FORMAT, version: VERSION, keys: {} };
    } catch {
      this.data = { format: FORMAT, version: VERSION, keys: {} };
    }
    return this.data;
  }

  async save() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, this.file);
  }

  async has(id) {
    const data = await this.load();
    return Boolean(data.keys[id]);
  }

  /** Tylko proces glowny. Zwraca null, gdy klucza nie ma albo nie da sie odczytac. */
  async get(id) {
    const data = await this.load();
    const stored = data.keys[id];
    if (!stored) return null;
    try {
      return this.backend.decrypt(Buffer.from(stored, 'base64'));
    } catch {
      // Klucz zaszyfrowany na innym koncie systemowym albo po przeniesieniu profilu.
      return null;
    }
  }

  async set(id, value) {
    const key = String(value || '').trim();
    if (!key) throw new Error('pusty klucz');
    if (!this.backend.available()) {
      throw new Error(
        'system nie udostepnia szyfrowania danych, wiec nie zapisze klucza API. '
        + 'Bez tego klucz lezalby na dysku jawnym tekstem.'
      );
    }
    const data = await this.load();
    data.keys[id] = Buffer.from(this.backend.encrypt(key)).toString('base64');
    await this.save();
    return true;
  }

  async clear(id) {
    const data = await this.load();
    if (!(id in data.keys)) return false;
    delete data.keys[id];
    await this.save();
    return true;
  }

  /** Same identyfikatory, bez wartosci - do pokazania w interfejsie. */
  async list() {
    const data = await this.load();
    return Object.keys(data.keys);
  }
}

module.exports = { SecretStore, safeStorageBackend, FORMAT, VERSION };
