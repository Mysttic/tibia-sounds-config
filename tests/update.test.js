'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  compareVersions, parseVersion, versionFromTag, installerNameFor, parseDigest,
  allowedDownload, pickAsset, pickLatest, fetchLatestRelease,
  REPO, RELEASES_API, RELEASES_PAGE, TAG_PREFIX, DOWNLOAD_PREFIX,
} = require('../electron/lib/update');

/**
 * Sprawdzanie aktualizacji dotyka sieci i uruchamia instalator, wiec jego czesc
 * decyzyjna jest wydzielona i testowana z podstawionym `fetchJson`. Zaden test
 * ponizej nie wychodzi do sieci.
 *
 * Wydania leza w tym repozytorium pod tagami `v<wersja>`. Wiekszosc tych testow
 * pilnuje dwoch rzeczy: ze za nasze wydanie uchodzi tylko taki tag i ze instalator
 * da sie pobrac wylacznie z plikow wydan tego repozytorium.
 */

const POBIERANIE = 'https://github.com/Mysttic/tibia-sounds-config/releases/download/';
const STRONA = 'https://github.com/Mysttic/tibia-sounds-config/releases/tag/';

function stub(odpowiedz) {
  const calls = [];
  const fetchJson = async (url, opts) => {
    calls.push({ url, opts });
    if (typeof odpowiedz === 'function') return odpowiedz(url, opts);
    return odpowiedz;
  };
  return { fetchJson, calls };
}

/** Wpis z listy wydan tego repozytorium, przyciety do pol, ktorych uzywamy. */
function wydanie(tag, { assets, wersjaPliku, ...reszta } = {}) {
  const v = versionFromTag(tag) || '0.0.0';
  const nazwa = installerNameFor(wersjaPliku || v);
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-09-06T10:00:00Z',
    html_url: `${STRONA}${tag}`,
    assets: assets ?? [{
      name: nazwa,
      browser_download_url: `${POBIERANIE}${tag}/${nazwa}`,
      size: 81_748_326,
      digest: 'sha256:f8b1ab962ae93ba4052dafff67f3ca09e1dab7690b5ab7d7cea4a6d0c965813b',
    }],
    ...reszta,
  };
}

test('parseVersion uzupelnia brakujace czlony i scina przyrostki', () => {
  assert.deepEqual(parseVersion('1.7.0'), [1, 7, 0]);
  assert.deepEqual(parseVersion('v1.7.0'), [1, 7, 0]);
  assert.deepEqual(parseVersion('2.0'), [2, 0, 0]);
  assert.deepEqual(parseVersion('1.8.0-rc.2'), [1, 8, 0]);
  assert.deepEqual(parseVersion('1.8.0+build9'), [1, 8, 0]);
  assert.deepEqual(parseVersion('bzdura'), [0, 0, 0]);
});

test('compareVersions porownuje liczbowo, nie tekstowo', () => {
  // Tekstowo "1.10.0" < "1.9.0", bo "1" < "9". Tu ma byc odwrotnie.
  assert.ok(compareVersions('1.9.0', '1.10.0') < 0);
  assert.ok(compareVersions('1.7.0', '1.6.1') > 0);
  assert.equal(compareVersions('1.7.0', 'v1.7.0'), 0);
});

test('versionFromTag przyjmuje tylko tagi v<wersja>', () => {
  assert.equal(TAG_PREFIX, 'v');
  assert.equal(versionFromTag('v1.9.0'), '1.9.0');
  assert.equal(versionFromTag('v1.10.2'), '1.10.2');
  assert.equal(versionFromTag('v2.0.0-rc.1'), '2.0.0-rc.1');
  // Tagi z czasow huba i tagi innych projektow to nie nasze wydania.
  assert.equal(versionFromTag('tibia-sounds-config-v1.8.0'), null);
  assert.equal(versionFromTag('chatt-v0.6.2'), null);
  // Samo `v` z przodu nie wystarczy, za nim musi stac caly numer.
  assert.equal(versionFromTag('v'), null);
  assert.equal(versionFromTag('vbzdura'), null);
  assert.equal(versionFromTag('v1.9'), null);
  assert.equal(versionFromTag('1.9.0'), null);
  assert.equal(versionFromTag(undefined), null);
});

test('parseDigest przyjmuje tylko poprawne sha256', () => {
  const ok = 'sha256:4cf2dbb7824df04b5fce875ca0b09dd1279e6eb6953ac730a36cefde6bef7ada';
  assert.equal(parseDigest(ok), ok.slice(7));
  assert.equal(parseDigest(ok.toUpperCase()), ok.slice(7));
  assert.equal(parseDigest('sha512:abc'), null);
  assert.equal(parseDigest('sha256:krotkie'), null);
});

test('allowedDownload przepuszcza wylacznie pliki wydan tego repozytorium', () => {
  assert.ok(allowedDownload(`${POBIERANIE}v1.9.0/s.exe`));
  // Hub, serwer plikow GitHuba, inne repozytorium i reszta github.com juz nie.
  for (const url of [
    'https://github.com/Mysttic/Mysttic/releases/download/tibia-sounds-config-v1.8.0/s.exe',
    'https://objects.githubusercontent.com/a/b.exe',
    'https://github.com/Mysttic/tibia-sounds-config-fork/releases/download/v1.9.0/s.exe',
    'https://github.com/Mysttic/tibia-sounds-config/archive/refs/tags/v1.9.0.zip',
    'http://github.com/Mysttic/tibia-sounds-config/releases/download/v1.9.0/s.exe',
    'https://github.com.evil.example/Mysttic/tibia-sounds-config/releases/download/v1/s.exe',
    'https://evil.example/a.exe',
    'nie-adres',
    undefined,
  ]) {
    assert.equal(allowedDownload(url), false, String(url));
  }
});

test('allowedDownload porownuje adres po rozebraniu, a nie tekst', () => {
  for (const url of [
    // Tekstowo zaczynaja sie od dozwolonego adresu, ale `..` wyprowadza je
    // z katalogu wydan, takze zapisane jako %2e%2e.
    `${POBIERANIE}../../../Mysttic/releases/download/v1/s.exe`,
    `${POBIERANIE}%2e%2e/%2E%2E/%2e%2e/Mysttic/releases/download/v1/s.exe`,
    // Login i inny port zmieniaja poczatek adresu.
    'https://evil@github.com/Mysttic/tibia-sounds-config/releases/download/v1.9.0/s.exe',
    'https://github.com:8443/Mysttic/tibia-sounds-config/releases/download/v1.9.0/s.exe',
  ]) {
    assert.equal(allowedDownload(url), false, url);
  }
  // Wielkie litery w hoscie i domyslny port to wciaz ten sam adres.
  assert.ok(allowedDownload('https://GitHub.com:443/Mysttic/tibia-sounds-config/releases/download/v1.9.0/s.exe'));
});

test('pickAsset dopasowuje po dokladnej nazwie i odrzuca adres spoza wydan repozytorium', () => {
  const dobry = {
    name: installerNameFor('1.9.0'),
    browser_download_url: `${POBIERANIE}v1.9.0/s.exe`,
    size: 7, digest: null,
  };
  assert.equal(pickAsset([dobry], installerNameFor('1.9.0')).size, 7);
  assert.equal(pickAsset([dobry], 'czegos-takiego-nie-ma.exe'), null);

  // Adres przychodzi z sieci, wiec obcy host albo inne repozytorium maja
  // skonczyc sie odmowa, a nie pobraniem czegokolwiek.
  for (const url of [
    'https://evil.example/s.exe',
    'https://github.com/Mysttic/Mysttic/releases/download/tibia-sounds-config-v1.9.0/s.exe',
  ]) {
    assert.equal(pickAsset([{ ...dobry, browser_download_url: url }], installerNameFor('1.9.0')), null, url);
  }
});

test('pickLatest pomija tagi spoza ukladu v<wersja>, szkice i wydania kandydujace', () => {
  const lista = [
    wydanie('tibia-sounds-config-v9.9.9'),
    wydanie('nightly'),
    { tag_name: 'v2.0.0', draft: true },
    { tag_name: 'v1.10.0', prerelease: true },
    wydanie('v1.9.0'),
    wydanie('v1.8.0'),
  ];
  assert.equal(pickLatest(lista).version, '1.9.0');
  assert.equal(pickLatest([wydanie('tibia-sounds-config-v9.9.9')]), null);
  assert.equal(pickLatest([]), null);
  assert.equal(pickLatest(undefined), null);
});

test('nowsze wydanie zwraca komplet danych do pobrania', async () => {
  const { fetchJson, calls } = stub([wydanie('v1.9.0')]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });

  assert.equal(wynik.status, 'newer');
  assert.equal(wynik.release.version, '1.9.0');
  assert.equal(wynik.release.asset.name, 'tibia-sounds-config-1.9.0-win-x64-setup.exe');
  assert.equal(wynik.release.asset.url, `${POBIERANIE}v1.9.0/tibia-sounds-config-1.9.0-win-x64-setup.exe`);
  assert.equal(wynik.release.asset.sha256.length, 64);
  // Pytamy o liste wydan tego repozytorium, nie o hub.
  assert.equal(calls[0].url,
    'https://api.github.com/repos/Mysttic/tibia-sounds-config/releases?per_page=30');
  assert.equal(calls[0].opts.headers['X-GitHub-Api-Version'], '2022-11-28');
  // Bez tokenu: repozytorium jest publiczne, a aplikacja nie ma sie czym logowac.
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('odsylacz "co sie zmienilo" jest skladany z numeru wersji, nie z odpowiedzi', async () => {
  // Adres skladamy z numeru wersji, a nie z pola w odpowiedzi, wiec nawet
  // podmienione `html_url` nie przestawi go na obca strone.
  const podmienione = wydanie('v1.9.0', { html_url: 'https://evil.example/x' });
  const { fetchJson } = stub([podmienione]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.release.pageUrl, `${STRONA}v1.9.0`);
});

test('tag w innym ukladzie nad naszym nie jest brany za nowsza wersje', async () => {
  // Tag w ukladzie huba albo bez numeru stoi na liscie wyzej, ale to nie jest
  // nasze wydanie i nie moze udawac nowszej wersji.
  const { fetchJson } = stub([
    wydanie('tibia-sounds-config-v9.9.9'), wydanie('nightly'), wydanie('v1.8.0'),
  ]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'current');
});

test('lista bez naszego wydania to "nic nowego", a nie blad', async () => {
  for (const lista of [[], [wydanie('tibia-sounds-config-v1.9.0')]]) {
    const { fetchJson } = stub(lista);
    const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'current', `dla ${JSON.stringify(lista.map((r) => r.tag_name))}`);
  }
});

test('ta sama i starsza wersja to "current", nie "newer"', async () => {
  for (const zdalna of ['1.9.0', '1.8.0', '0.9.9']) {
    const { fetchJson } = stub([wydanie(`v${zdalna}`)]);
    const wynik = await fetchLatestRelease({ currentVersion: '1.9.0', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'current', `dla zdalnej ${zdalna}`);
  }
});

test('nowsze wydanie bez instalatora z tego repozytorium jest zglaszane bez assetu', async () => {
  const zHuba = {
    name: installerNameFor('1.9.0'),
    browser_download_url: 'https://github.com/Mysttic/Mysttic/releases/download/tibia-sounds-config-v1.9.0/s.exe',
    size: 7,
  };
  for (const assets of [[], [zHuba]]) {
    const { fetchJson } = stub([wydanie('v1.9.0', { assets })]);
    const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'newer');
    assert.equal(wynik.release.asset, null);
    // Zostaje odeslanie na strone wydania.
    assert.equal(wynik.release.pageUrl, `${STRONA}v1.9.0`);
  }
});

test('blad sieci konczy sie "failed" z powodem, a nie wyjatkiem', async () => {
  const { fetchJson } = stub(() => { throw new Error('przekroczono limit 10000 ms'); });
  const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'failed');
  assert.match(wynik.error, /limit/);
});

test('odpowiedz, ktora nie jest lista, nie przechodzi jako aktualizacja', async () => {
  for (const smiec of [null, 'tekst', 42, {}, { tag_name: 'v9.9.9' }]) {
    const { fetchJson } = stub(smiec);
    const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'failed', `dla ${JSON.stringify(smiec)}`);
  }
});

test('poza Windowsem nie pytamy GitHuba w ogole', async () => {
  const { fetchJson, calls } = stub([wydanie('v9.9.9')]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.8.0', fetchJson, platform: 'linux' });
  assert.equal(wynik.status, 'failed');
  assert.equal(calls.length, 0);
});

test('adresy sa przybite do https i do tego repozytorium', () => {
  assert.equal(REPO, 'Mysttic/tibia-sounds-config');
  assert.ok(RELEASES_API.startsWith('https://api.github.com/repos/Mysttic/tibia-sounds-config/'));
  assert.equal(RELEASES_PAGE, 'https://github.com/Mysttic/tibia-sounds-config/releases');
  assert.equal(DOWNLOAD_PREFIX, POBIERANIE);
});

test('aplikacja nie odwoluje sie juz do huba ani do jego strony', () => {
  // Hub nie dostaje juz wydan, a strona projektu na nim znika, wiec nic w kodzie
  // aplikacji nie moze od nich zalezec.
  const root = path.join(__dirname, '..');
  const pliki = [];
  for (const dir of ['electron', 'renderer']) {
    for (const wpis of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      if (/\.(js|html|css)$/.test(wpis)) pliki.push(path.join(root, dir, wpis));
    }
  }
  assert.ok(pliki.length > 10, `za malo plikow: ${pliki.length}`);
  for (const plik of pliki) {
    const tresc = fs.readFileSync(plik, 'utf8');
    for (const zakazane of ['Mysttic/Mysttic', 'mysttic.github.io']) {
      assert.ok(!tresc.includes(zakazane), `${path.relative(root, plik)} zawiera ${zakazane}`);
    }
  }
});
