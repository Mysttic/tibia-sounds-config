'use strict';

/**
 * Sprawdzanie, czy wyszlo nowsze wydanie.
 *
 * Aplikacja pyta o to publiczne API GitHuba i nie wysyla przy tym niczego poza
 * tym, co widzi kazdy serwer https. Domyslnie nie pyta wcale: albo klikasz
 * "Sprawdz aktualizacje" w menu, albo sam wlaczasz automatyczne sprawdzanie.
 *
 * Caly modul jest czysty i nie dotyka Electrona ani dysku, zeby dalo sie go
 * przetestowac bez uruchamiania aplikacji. Pobieranie i instalacja sa
 * w `main.js`, bo wymagaja procesu glownego.
 */

const REPO = 'Mysttic/tibia-sounds-config';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

/** Co ile aplikacja pyta sama, gdy wlaczysz automatyczne sprawdzanie. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Sprawdzenie wersji to czynnosc poboczna, wiec lepiej odpuscic niz wisiec. */
const CHECK_TIMEOUT_MS = 10_000;

/**
 * Limit na pobierany instalator. Wydanie 1.6.1 wazy 78 MB, wiec 200 MB to zapas
 * na kilka lat wzrostu Electrona; jednoczesnie odsiewa odpowiedz, ktora nagle
 * okazuje sie czyms innym, niz sie spodziewamy.
 */
const MAX_INSTALLER_BYTES = 200 * 1024 * 1024;

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

function pickAsset(assets, wanted) {
  for (const a of Array.isArray(assets) ? assets : []) {
    if (a && a.name === wanted) {
      return {
        name: a.name,
        url: a.browser_download_url || null,
        size: Number.isFinite(a.size) ? a.size : null,
        sha256: parseDigest(a.digest),
      };
    }
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

  if (!json || typeof json !== 'object') {
    return { status: 'failed', error: 'GitHub odpowiedzial czyms, czego nie rozumiem' };
  }
  // Szkic i wydanie kandydujace to nie jest cos, co ktos ma dostac z automatu.
  if (json.draft === true || json.prerelease === true) {
    return { status: 'current' };
  }

  const tag = typeof json.tag_name === 'string' ? json.tag_name.trim() : '';
  if (!tag) return { status: 'failed', error: 'wydanie bez numeru wersji' };

  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (compareVersions(currentVersion, version) >= 0) {
    return { status: 'current' };
  }

  const asset = pickAsset(json.assets, installerNameFor(version));

  return {
    status: 'newer',
    checkedAt: now(),
    release: {
      version,
      notes: typeof json.body === 'string' ? json.body.trim() : '',
      publishedAt: typeof json.published_at === 'string' ? json.published_at : null,
      pageUrl: typeof json.html_url === 'string' ? json.html_url : RELEASES_PAGE,
      asset,
    },
  };
}

module.exports = {
  REPO,
  RELEASES_API,
  RELEASES_PAGE,
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  MAX_INSTALLER_BYTES,
  API_HEADERS,
  parseVersion,
  compareVersions,
  installerNameFor,
  parseDigest,
  pickAsset,
  fetchLatestRelease,
};
