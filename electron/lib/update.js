'use strict';

/**
 * Sprawdzanie, czy wyszlo nowsze wydanie.
 *
 * Aplikacja pyta publiczne API GitHuba o wydania tego repozytorium
 * (`Mysttic/tibia-sounds-config`) i bierze najnowsze z tagiem `v<wersja>`, czyli
 * takim, jaki zaklada workflow `Release`. Zapytanie idzie bez tokenu, wiec dziala
 * tylko wtedy, gdy repozytorium jest publiczne.
 *
 * Pytamy o liste, a nie o `/releases/latest`, i bierzemy pierwsze pasujace, bo API
 * zwraca wydania od najnowszych. Wydanie z tagiem w innym ukladzie zostaje wtedy
 * pominiete, zamiast przeslonic prawdziwe.
 *
 * Kopie 1.8.0 pytaja zamiast tego osobne repozytorium serwisu (hub) o tagi
 * `tibia-sounds-config-v<wersja>`. Hub nie dostaje juz wydan i ostatnim zostaje
 * tam 1.8.0, wiec taka kopie trzeba raz zaktualizowac recznie, do 1.9.0 albo
 * nowszej.
 *
 * Domyslnie aplikacja nie pyta wcale: albo klikasz "Sprawdz aktualizacje" w menu,
 * albo sam wlaczasz automatyczne sprawdzanie.
 *
 * Caly modul jest czysty i nie dotyka Electrona ani dysku, zeby dalo sie go
 * przetestowac bez uruchamiania aplikacji. Pobieranie i instalacja sa
 * w `main.js`, bo wymagaja procesu glownego.
 */

/** Repozytorium z kodem i z wydaniami: stad biora sie wersje, opisy i pliki. */
const REPO = 'Mysttic/tibia-sounds-config';

/** Workflow `Release` taguje wydania jako `v<wersja>`. */
const TAG_PREFIX = 'v';

const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

/** Co ile aplikacja pyta sama, gdy wlaczysz automatyczne sprawdzanie. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Sprawdzenie wersji to czynnosc poboczna, wiec lepiej odpuscic niz wisiec. */
const CHECK_TIMEOUT_MS = 10_000;

/**
 * Limit na pobierany instalator. Wydanie 1.7.0 wazy 78 MB, wiec 200 MB to zapas
 * na kilka lat wzrostu Electrona; jednoczesnie odsiewa odpowiedz, ktora nagle
 * okazuje sie czyms innym, niz sie spodziewamy.
 */
const MAX_INSTALLER_BYTES = 200 * 1024 * 1024;

/**
 * Skad wolno pobierac instalator: wylacznie z plikow wydan tego repozytorium.
 *
 * Adres przychodzi z sieci, wiec zanim cokolwiek pobierzemy, sprawdzamy, czy
 * wskazuje dokladnie to miejsce, a nie tylko dowolny adres na GitHubie.
 * `assertHttps` w warstwie sieciowej pilnuje protokolu, to pilnuje miejsca.
 * Dalej github.com sam przekierowuje pobranie na swoj serwer plikow, wiec
 * sprawdzamy pierwszy adres, ten z odpowiedzi API.
 */
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * Numer wersji sprowadzony do trzech czlonow.
 *
 * Przyrostki (`-rc.1`, `+build`) sa scinane celowo: nie decyduja o tym, czy warto
 * sie aktualizowac, a wydania kandydujace i tak odrzucamy po fladze `prerelease`.
 */
function parseVersion(text) {
  let t = String(text ?? '').trim();
  if (t.startsWith('v') || t.startsWith('V')) t = t.slice(1);
  t = t.split(/[-+]/)[0];
  const parts = t.split('.').map((c) => {
    const n = Number.parseInt(c.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

/** Ujemne, gdy `a` jest starsze niz `b`. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * `v1.9.0` -> `1.9.0`. Za `v` musi stac numer w tym samym ukladzie co w VERSION.md:
 * tag, ktory tylko zaczyna sie na `v`, to nie jest nasze wydanie.
 */
function versionFromTag(tag) {
  const t = String(tag ?? '').trim();
  if (!t.startsWith(TAG_PREFIX)) return null;
  const reszta = t.slice(TAG_PREFIX.length);
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(reszta) ? reszta : null;
}

/**
 * Nazwa instalatora dla tej wersji. Wzorzec pochodzi z `nsis.artifactName`
 * w `electron-builder.yml` - jesli tam sie zmieni, tu tez trzeba poprawic.
 */
function installerNameFor(version) {
  return `tibia-sounds-config-${version}-win-x64-setup.exe`;
}

/**
 * Suma kontrolna zasobu, ktora GitHub podaje jako `sha256:<hex>`.
 *
 * Uwaga na uczciwosc opisu: ta suma przychodzi ta sama odpowiedzia co adres
 * pliku, wiec nie jest niezaleznym punktem zaufania. Chroni przed uszkodzonym
 * albo uciętym pobraniem, a nie przed przejeciem konta wydawcy.
 */
function parseDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Porownujemy adres po przejsciu przez `URL`, a nie surowy tekst. Parser rozwija
 * `..` (takze zapisane jako `%2e%2e`) i normalizuje host, a dopisany login albo
 * port zmienia poczatek adresu, wiec nic z tego nie wyprowadzi pobrania poza pliki
 * wydan tego repozytorium.
 */
function allowedDownload(url) {
  try {
    return new URL(url).href.startsWith(DOWNLOAD_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Zasob o dokladnie tej nazwie. Zwraca `null` rowniez wtedy, gdy adres nie
 * wskazuje plikow wydan tego repozytorium: wolimy powiedziec "to wydanie nie ma
 * instalatora" i odeslac na strone, niz pobrac cokolwiek spod innego adresu.
 */
function pickAsset(assets, wanted) {
  for (const a of Array.isArray(assets) ? assets : []) {
    if (!a || a.name !== wanted) continue;
    const url = a.browser_download_url || null;
    if (!url || !allowedDownload(url)) return null;
    return {
      name: a.name,
      url,
      size: Number.isFinite(a.size) ? a.size : null,
      sha256: parseDigest(a.digest),
    };
  }
  return null;
}

/**
 * Najnowsze wydanie z listy zwroconej przez API.
 *
 * Szkic i wydanie kandydujace to nie jest cos, co ktos ma dostac z automatu,
 * a tag w innym ukladzie niz `v<wersja>` to nie nasze wydanie.
 * Lista bez naszego wydania oznacza "nic nowego", a nie blad.
 */
function pickLatest(lista) {
  for (const r of Array.isArray(lista) ? lista : []) {
    if (!r || r.draft === true || r.prerelease === true) continue;
    const version = versionFromTag(r.tag_name);
    if (version) return { ...r, version };
  }
  return null;
}

/**
 * Pyta GitHuba o najnowsze wydanie.
 *
 * Nie rzuca niczym. Sprawdzanie wersji nie ma prawa zepsuc niczego w aplikacji,
 * wiec kazda awaria konczy sie `status: 'failed'` z powodem do pokazania.
 *
 * Rozroznienie `failed` od `current` jest istotne: pierwsze mowi o sieci,
 * drugie o wersji, i na ekranie to dwa rozne komunikaty.
 */
async function fetchLatestRelease({
  currentVersion,
  fetchJson,
  platform = process.platform,
  now = () => Date.now(),
} = {}) {
  if (platform !== 'win32') {
    return { status: 'failed', error: 'aktualizacje z poziomu aplikacji dzialaja tylko na Windows' };
  }

  let json;
  try {
    json = await fetchJson(RELEASES_API, { timeoutMs: CHECK_TIMEOUT_MS, headers: API_HEADERS });
  } catch (err) {
    return { status: 'failed', error: err && err.message ? err.message : 'nie udalo sie zapytac GitHuba' };
  }

  if (!Array.isArray(json)) {
    return { status: 'failed', error: 'GitHub odpowiedzial czyms, czego nie rozumiem' };
  }

  const rel = pickLatest(json);
  if (!rel) return { status: 'current' };
  if (compareVersions(currentVersion, rel.version) >= 0) return { status: 'current' };

  return {
    status: 'newer',
    checkedAt: now(),
    release: {
      version: rel.version,
      publishedAt: typeof rel.published_at === 'string' ? rel.published_at : null,
      // Adres "co sie zmienilo" skladamy z numeru wersji, a nie z pola `html_url`
      // w odpowiedzi: dzieki temu nie otwieramy niczego, co przyszlo z sieci.
      pageUrl: `https://github.com/${REPO}/releases/tag/v${rel.version}`,
      asset: pickAsset(rel.assets, installerNameFor(rel.version)),
    },
  };
}

module.exports = {
  REPO,
  TAG_PREFIX,
  RELEASES_API,
  RELEASES_PAGE,
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  MAX_INSTALLER_BYTES,
  DOWNLOAD_PREFIX,
  API_HEADERS,
  parseVersion,
  compareVersions,
  versionFromTag,
  installerNameFor,
  parseDigest,
  allowedDownload,
  pickAsset,
  pickLatest,
  fetchLatestRelease,
};
