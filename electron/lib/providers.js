'use strict';

const { fetchJson, assertHttps } = require('./net');

/**
 * Zrodla dzwiekow do wyszukiwania w sieci.
 *
 * Dwa poziomy odpowiedzialnosci:
 *  - WBUDOWANE (builtin: true) - sprawdzone przez nas pod katem regulaminu i licencji.
 *    Openverse jest filtrowany twardo do CC0, Internet Archive ograniczony do kolekcji,
 *    ktore w calosci sa CC0. Za te zrodla odpowiadamy.
 *  - WLASNE uzytkownika - deklaratywne adaptery JSON dodawane w ustawieniach.
 *    Aplikacja nie weryfikuje ani regulaminu, ani licencji takiego zrodla; to lezy
 *    po stronie osoby, ktora je dodala.
 *
 * Kazde zrodlo zwraca wyniki w jednym ksztalcie:
 *   { id, title, author, license, licenseUrl, attribution, durationSec, audioUrl, pageUrl, providerId }
 */

// --- pomocnicze --------------------------------------------------------------

/** Odczyt zagniezdzonego pola po sciezce "a.b.c" (obsluguje indeksy tablic). */
function pick(obj, dottedPath) {
  if (!dottedPath) return undefined;
  return dottedPath.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, obj);
}

/** Openverse podaje czas w sekundach albo milisekundach zaleznie od zrodla. */
function normalizeDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1000 ? n / 1000 : n;
}

function normalizeResult(raw, providerId) {
  return {
    providerId,
    id: String(raw.id ?? raw.audioUrl ?? ''),
    title: String(raw.title || '(bez tytulu)').slice(0, 200),
    author: raw.author ? String(raw.author).slice(0, 120) : '',
    license: raw.license ? String(raw.license).toUpperCase() : '',
    licenseUrl: raw.licenseUrl || '',
    attribution: raw.attribution || '',
    durationSec: normalizeDuration(raw.durationSec),
    audioUrl: raw.audioUrl,
    pageUrl: raw.pageUrl || '',
  };
}

// --- Openverse ---------------------------------------------------------------

/**
 * Openverse (WordPress Foundation) agreguje m.in. Freesound i udostepnia wyszukiwanie
 * anonimowo, bez klucza API. Filtr license=cc0 jest wymuszony w kodzie - bez niego
 * w wynikach pojawiaja sie pliki CC-BY-NC, ktorych nie chcemy podsuwac uzytkownikowi.
 *
 * Limity anonimowe: page_size max 20, 20 zapytan/min, 200/dobe.
 */
const openverse = {
  id: 'openverse',
  name: 'Openverse (CC0)',
  builtin: true,
  description: 'Agregator wolnych tresci, m.in. Freesound. Tylko pliki CC0 - bez wymogu atrybucji.',
  homepage: 'https://openverse.org/',

  async search(query, { limit = 20, fetchJson: get = fetchJson } = {}) {
    const url = new URL('https://api.openverse.org/v1/audio/');
    url.searchParams.set('q', query);
    url.searchParams.set('license', 'cc0'); // twardo - nie parametryzujemy
    url.searchParams.set('page_size', String(Math.min(limit, 20)));
    url.searchParams.set('page', '1');

    const data = await get(url.toString());
    const results = (data.results || [])
      .filter((r) => r.url)
      .map((r) => normalizeResult({
        id: r.id,
        title: r.title,
        author: r.creator,
        license: r.license,
        licenseUrl: r.license_url,
        attribution: r.attribution,
        durationSec: r.duration,
        audioUrl: r.url,
        pageUrl: r.foreign_landing_url,
      }, 'openverse'));

    return { total: data.result_count || results.length, results };
  },
};

// --- Internet Archive --------------------------------------------------------

/**
 * Internet Archive ma ogromny katalog, ale ~80% pozycji oznaczonych "sound effects"
 * nie ma zadnej informacji o licencji, a wysoko rankuja sie ripy z gier i piracone
 * biblioteki komercyjne. Dlatego pytamy WYLACZNIE o kolekcje, ktore w calosci sa CC0.
 * Bez tej bialej listy zrodlo byloby nie do obrony prawnie.
 */
const ARCHIVE_COLLECTIONS = ['usc-sound-effect-archive', 'folksoundomy_effects'];
const ARCHIVE_AUDIO_EXT = /\.(mp3|ogg|wav|flac|m4a)$/i;
// IA trzyma to samo nagranie w kilku formatach (oryginal WAV + derywaty MP3/Ogg).
// Bierzemy jeden plik na nagranie, zaczynajac od najlzejszego formatu.
const ARCHIVE_FORMAT_RANK = { '.ogg': 0, '.mp3': 1, '.m4a': 2, '.flac': 3, '.wav': 4 };

/** IA podaje `length` raz jako sekundy ("46.11"), raz jako "M:SS" albo "H:MM:SS". */
function parseArchiveLength(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  if (!text.includes(':')) return Number(text) || 0;
  return text.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0);
}

function dedupeArchiveFiles(files) {
  const best = new Map();
  for (const file of files) {
    const name = file.name || '';
    if (!ARCHIVE_AUDIO_EXT.test(name)) continue;
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    const key = name.slice(0, name.lastIndexOf('.')).toLowerCase();
    const rank = ARCHIVE_FORMAT_RANK[ext] ?? 9;
    const current = best.get(key);
    if (!current || rank < current.rank) best.set(key, { file, rank });
  }
  return [...best.values()].map((v) => v.file);
}

const archive = {
  id: 'archive',
  name: 'Internet Archive (USC, CC0)',
  builtin: true,
  description: 'Kuratorowane kolekcje CC0: efekty filmowe, bronie, syreny, zwierzeta, tlumy.',
  homepage: 'https://archive.org/details/usc-sound-effect-archive',

  async search(query, { limit = 20, maxItems = 5, fetchJson: get = fetchJson } = {}) {
    const collections = ARCHIVE_COLLECTIONS.map((c) => `collection:(${c})`).join(' OR ');
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', `(${collections}) AND (${query})`);
    url.searchParams.append('fl[]', 'identifier');
    url.searchParams.append('fl[]', 'title');
    url.searchParams.append('fl[]', 'licenseurl');
    url.searchParams.set('rows', String(maxItems));
    url.searchParams.set('page', '1');
    url.searchParams.set('output', 'json');

    const found = await get(url.toString());
    const items = (found.response && found.response.docs) || [];

    // Wyszukiwarka IA indeksuje POZYCJE, nie pliki - trzeba dociagnac liste plikow.
    const perItem = await Promise.all(items.map(async (item) => {
      try {
        const meta = await get(`https://archive.org/metadata/${encodeURIComponent(item.identifier)}`);
        return dedupeArchiveFiles(meta.files || [])
          .slice(0, 6)
          .map((f) => normalizeResult({
            id: `${item.identifier}/${f.name}`,
            title: f.name.split('/').pop().replace(ARCHIVE_AUDIO_EXT, ''),
            author: item.title || item.identifier,
            license: 'CC0',
            licenseUrl: item.licenseurl || 'https://creativecommons.org/publicdomain/zero/1.0/',
            attribution: '',
            durationSec: parseArchiveLength(f.length),
            audioUrl: `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodeURI(f.name)}`,
            pageUrl: `https://archive.org/details/${item.identifier}`,
          }, 'archive'));
      } catch {
        return []; // pojedyncza pozycja bez metadanych nie moze wywalic calego wyszukiwania
      }
    }));

    const results = perItem.flat().slice(0, limit);
    return { total: results.length, results };
  },
};

// --- adapter uzytkownika -----------------------------------------------------

/**
 * Deklaratywne zrodlo definiowane przez uzytkownika w ustawieniach. Pozwala podpiac
 * dowolny serwis z JSON-owym API bez pisania kodu.
 *
 * {
 *   "id": "moje",
 *   "name": "Moje zrodlo",
 *   "searchUrl": "https://przyklad.pl/api?q={query}&limit={limit}",
 *   "resultsPath": "results",
 *   "map": { "title": "name", "audioUrl": "file", "author": "user", "license": "license" },
 *   "audioUrlPrefix": "https://przyklad.pl/media/"
 * }
 *
 * Aplikacja nie sprawdza regulaminu ani licencji takiego zrodla.
 */
function customProvider(def) {
  if (!def || !def.id || !def.searchUrl) {
    throw new Error('wlasne zrodlo wymaga pol "id" i "searchUrl"');
  }
  assertHttps(def.searchUrl.replace(/\{query\}|\{limit\}/g, 'x'));
  const map = def.map || {};

  return {
    id: def.id,
    name: def.name || def.id,
    builtin: false,
    description: 'Zrodlo dodane przez uzytkownika - licencje i regulamin sprawdzasz sam.',
    homepage: def.homepage || '',

    async search(query, { limit = 20, fetchJson: get = fetchJson } = {}) {
      const url = def.searchUrl
        .replace('{query}', encodeURIComponent(query))
        .replace('{limit}', String(limit));

      const data = await get(url);
      const rows = def.resultsPath ? pick(data, def.resultsPath) : data;
      if (!Array.isArray(rows)) {
        throw new Error(`pole "${def.resultsPath || '(korzen)'}" nie jest tablica wynikow`);
      }

      const results = rows.slice(0, limit).map((row, i) => {
        const rawUrl = pick(row, map.audioUrl);
        if (!rawUrl) return null;
        // Prefiks doklejamy tylko do sciezek wzglednych. Wartosc juz absolutna
        // zostawiamy w spokoju - inaczej "http://zle.pl/x" skleiloby sie w pozornie
        // poprawny adres https i przeszloby walidacje.
        const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(String(rawUrl));
        const audioUrl = (def.audioUrlPrefix && !isAbsolute)
          ? `${def.audioUrlPrefix}${rawUrl}`
          : String(rawUrl);
        try {
          assertHttps(audioUrl);
        } catch {
          return null;
        }
        return normalizeResult({
          id: pick(row, map.id) || `${def.id}-${i}`,
          title: pick(row, map.title) || `wynik ${i + 1}`,
          author: pick(row, map.author) || '',
          license: pick(row, map.license) || '',
          licenseUrl: pick(row, map.licenseUrl) || '',
          durationSec: pick(row, map.durationSec) || 0,
          audioUrl,
          pageUrl: pick(row, map.pageUrl) || '',
        }, def.id);
      }).filter(Boolean);

      return { total: results.length, results };
    },
  };
}

// --- rejestr -----------------------------------------------------------------

const BUILTIN = [openverse, archive];

/** Lista dostepnych zrodel: wbudowane + zdefiniowane przez uzytkownika. */
function listProviders(customDefs = []) {
  const custom = [];
  for (const def of customDefs) {
    try {
      custom.push(customProvider(def));
    } catch {
      // niepoprawna definicja nie moze wywalic listy - po prostu jej nie pokazujemy
    }
  }
  return [...BUILTIN, ...custom];
}

function getProvider(id, customDefs = []) {
  const found = listProviders(customDefs).find((p) => p.id === id);
  if (!found) throw new Error(`nieznane zrodlo: ${id}`);
  return found;
}

module.exports = {
  listProviders,
  getProvider,
  customProvider,
  normalizeResult,
  normalizeDuration,
  parseArchiveLength,
  dedupeArchiveFiles,
  pick,
  BUILTIN,
  ARCHIVE_COLLECTIONS,
  openverse,
  archive,
};
