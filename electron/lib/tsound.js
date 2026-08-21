'use strict';

const path = require('node:path');

const { FILENAME_HASH } = require('./catalog');

/**
 * Rozstrzyganie adresow protokolu `tsound://`.
 *
 *   tsound://sound/<plik.ogg>     -> aktualny plik w kliencie
 *   tsound://original/<plik.ogg>  -> kopia oryginalu z vaulta (podglad A/B)
 *   tsound://preview/<klucz>      -> wynik z sieci, strumieniowany przez proces glowny
 *   tsound://library/<id>         -> wygenerowany dzwiek z biblioteki uzytkownika
 *
 * Wydzielone z main.js, bo to jedyna bariera miedzy nazwa przyslana przez renderer
 * a odczytem pliku z dysku - a w main.js nie da sie jej przetestowac bez uruchamiania
 * calego Electrona. Tutaj jest to czysta funkcja: wchodzi adres, wychodzi decyzja.
 *
 * Odsluch wyniku z sieci idzie przez klucz, a nie przez adres, wiec CSP okna moze
 * zostac zamkniete (media-src tsound:) i to proces glowny nawiazuje polaczenie.
 * Sam adres renderer widzi w wynikach wyszukiwania - nie ma z niego jednak jak
 * skorzystac, bo nie ma dostepu do sieci.
 */

/** Pamiec podgladow z sieci: klucz -> URL. Ograniczona, zeby nie rosla bez konca. */
class PreviewStore {
  constructor(limit = 200) {
    this.limit = limit;
    this.map = new Map();
  }

  /** Zapamietuje adres i zwraca jego klucz. Ponowne uzycie odswieza wpis. */
  remember(url, key) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, url);
    // Najstarsze wpisy wypadaja - stary wynik wyszukiwania przestaje byc pobieralny.
    while (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value);
    }
    return key;
  }

  get(key) {
    return this.map.get(key) || null;
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

/**
 * @returns {{kind:'preview', url:string}
 *         | {kind:'file', file:string}
 *         | {error:string, status:number}}
 */
/** Identyfikator wpisu biblioteki - nasza wlasna losowa wartosc, nigdy z zewnatrz. */
const LIBRARY_ID = /^[0-9a-f]{16}$/;

function resolveTsound(rawUrl, { client, vault, previews } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'niepoprawny adres', status: 400 };
  }

  let name;
  try {
    name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    // np. "%zz" - nie da sie odkodowac, wiec na pewno nie jest to nasza nazwa pliku
    return { error: 'niepoprawna nazwa zasobu', status: 400 };
  }

  const kind = url.hostname;

  if (kind === 'preview') {
    const target = previews && previews.get(name);
    if (!target) return { error: 'nieznany podglad', status: 404 };
    return { kind: 'preview', url: target };
  }

  // Wpis biblioteki lezy poza katalogiem klienta, wiec nie pasuje do wzorca nazwy pliku.
  // Tutaj sprawdzamy tylko ksztalt identyfikatora; wlasciwa bariera jest w bibliotece,
  // ktora zamienia id na sciezke wylacznie na podstawie wlasnego spisu.
  if (kind === 'library') {
    if (!LIBRARY_ID.test(name)) return { error: 'zly identyfikator', status: 400 };
    return { kind: 'library', id: name };
  }

  if (kind !== 'sound' && kind !== 'original') {
    return { error: 'nieznany zasob', status: 404 };
  }

  // Jedyna bariera przed odczytem dowolnej sciezki. Wzorzec nie dopuszcza
  // separatorow ani kropek, wiec "..", "/" i "\" odpadaja tutaj.
  if (!FILENAME_HASH.test(name)) return { error: 'zla nazwa pliku', status: 400 };

  if (!client || !vault) return { error: 'nie wybrano klienta', status: 409 };

  const dir = kind === 'sound' ? client.soundsDir : vault.originalsDir;
  const file = path.resolve(dir, name);

  // Pas i szelki: nawet gdyby wzorzec kiedys zluzowal, plik musi lezec
  // bezposrednio w swoim katalogu.
  if (path.dirname(file) !== path.resolve(dir)) {
    return { error: 'zla nazwa pliku', status: 400 };
  }

  return { kind: 'file', file };
}

module.exports = { PreviewStore, resolveTsound, LIBRARY_ID };
