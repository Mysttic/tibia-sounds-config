'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions, parseVersion, versionFromTag, installerNameFor, parseDigest,
  allowedDownload, pickAsset, pickLatest, fetchLatestRelease,
  RELEASES_API, RELEASES_PAGE, TAG_PREFIX, HUB,
} = require('../electron/lib/update');

/**
 * Sprawdzanie aktualizacji dotyka sieci i uruchamia instalator, wiec jego czesc
 * decyzyjna jest wydzielona i testowana z podstawionym `fetchJson`. Zaden test
 * ponizej nie wychodzi do sieci.
 *
 * Wydania wszystkich projektow leza w jednym repozytorium, wiec wiekszosc tych
 * testow pilnuje jednej rzeczy: ze nie wezmiemy cudzego wydania za swoje.
 */

function stub(odpowiedz) {
  const calls = [];
  const fetchJson = async (url, opts) => {
    calls.push({ url, opts });
    if (typeof odpowiedz === 'function') return odpowiedz(url, opts);
    return odpowiedz;
  };
  return { fetchJson, calls };
}

/** Wpis z listy wydan huba, przyciety do pol, ktorych uzywamy. */
function wydanie(tag, { assets, wersjaPliku, ...reszta } = {}) {
  const v = versionFromTag(tag) || '0.0.0';
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-09-06T10:00:00Z',
    html_url: `https://github.com/${HUB}/releases/tag/${tag}`,
    assets: assets ?? [{
      name: installerNameFor(wersjaPliku || v),
      browser_download_url: `https://github.com/${HUB}/releases/download/${tag}/setup.exe`,
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

test('versionFromTag przyjmuje tylko tagi z naszym prefiksem', () => {
  assert.equal(versionFromTag('tibia-sounds-config-v1.7.0'), '1.7.0');
  assert.equal(versionFromTag('chatt-v0.6.2'), null);
  assert.equal(versionFromTag('v1.7.0'), null);
  assert.equal(versionFromTag('tibia-sounds-config-v'), null);
  assert.equal(versionFromTag(undefined), null);
  assert.ok(TAG_PREFIX.endsWith('-v'));
});

test('parseDigest przyjmuje tylko poprawne sha256', () => {
  const ok = 'sha256:4cf2dbb7824df04b5fce875ca0b09dd1279e6eb6953ac730a36cefde6bef7ada';
  assert.equal(parseDigest(ok), ok.slice(7));
  assert.equal(parseDigest(ok.toUpperCase()), ok.slice(7));
  assert.equal(parseDigest('sha512:abc'), null);
  assert.equal(parseDigest('sha256:krotkie'), null);
});

test('allowedDownload przepuszcza wylacznie https na hostach GitHuba', () => {
  assert.ok(allowedDownload('https://github.com/Mysttic/Mysttic/releases/download/x/y.exe'));
  assert.ok(allowedDownload('https://objects.githubusercontent.com/a/b.exe'));
  assert.equal(allowedDownload('http://github.com/a.exe'), false);
  assert.equal(allowedDownload('https://github.com.evil.example/a.exe'), false);
  assert.equal(allowedDownload('https://evil.example/a.exe'), false);
  assert.equal(allowedDownload('nie-adres'), false);
});

test('pickAsset dopasowuje po dokladnej nazwie i odrzuca obcy host', () => {
  const dobry = {
    name: installerNameFor('1.8.0'),
    browser_download_url: 'https://github.com/Mysttic/Mysttic/releases/download/t/s.exe',
    size: 7, digest: null,
  };
  assert.equal(pickAsset([dobry], installerNameFor('1.8.0')).size, 7);
  assert.equal(pickAsset([dobry], 'czegos-takiego-nie-ma.exe'), null);

  // Adres przychodzi z sieci, wiec podmieniony host ma skonczyc sie odmowa,
  // a nie pobraniem czegokolwiek.
  const obcy = { ...dobry, browser_download_url: 'https://evil.example/s.exe' };
  assert.equal(pickAsset([obcy], installerNameFor('1.8.0')), null);
});

test('pickLatest pomija cudze projekty, szkice i wydania kandydujace', () => {
  const lista = [
    wydanie('chatt-v9.9.9'),
    { tag_name: 'tibia-sounds-config-v2.0.0', draft: true },
    { tag_name: 'tibia-sounds-config-v1.9.0', prerelease: true },
    wydanie('tibia-sounds-config-v1.8.0'),
    wydanie('tibia-sounds-config-v1.7.0'),
  ];
  assert.equal(pickLatest(lista).version, '1.8.0');
  assert.equal(pickLatest([wydanie('chatt-v9.9.9')]), null);
  assert.equal(pickLatest([]), null);
  assert.equal(pickLatest(undefined), null);
});

test('nowsze wydanie zwraca komplet danych do pobrania', async () => {
  const { fetchJson, calls } = stub([wydanie('tibia-sounds-config-v1.8.0')]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });

  assert.equal(wynik.status, 'newer');
  assert.equal(wynik.release.version, '1.8.0');
  assert.equal(wynik.release.asset.name, 'tibia-sounds-config-1.8.0-win-x64-setup.exe');
  assert.equal(wynik.release.asset.sha256.length, 64);
  assert.equal(calls[0].url, RELEASES_API);
  // /releases/latest oddaloby wydanie cudzego projektu, wiec pytamy o liste.
  assert.ok(calls[0].url.includes('/releases?per_page='));
  assert.equal(calls[0].opts.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('odsylacz "co sie zmienilo" wskazuje nasze repo, nie hub', async () => {
  // Adres skladamy z numeru wersji, a nie z pola w odpowiedzi, wiec nawet
  // podmienione `html_url` nie przestawi go na obca strone.
  const podmienione = wydanie('tibia-sounds-config-v1.8.0', { html_url: 'https://evil.example/x' });
  const { fetchJson } = stub([podmienione]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.release.pageUrl, 'https://github.com/Mysttic/tibia-sounds-config/releases/tag/v1.8.0');
});

test('cudze wydanie nad naszym nie jest brane za nasze', async () => {
  // Hub trzyma wydania kilku projektow, a Chatt wydaje czesciej. Jego 9.9.9
  // stoi na liscie wyzej i przed poprawka wygladalo jak nasza nowa wersja.
  const { fetchJson } = stub([wydanie('chatt-v9.9.9'), wydanie('tibia-sounds-config-v1.7.0')]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'current');
});

test('lista bez naszego wydania to "nic nowego", a nie blad', async () => {
  const { fetchJson } = stub([wydanie('chatt-v0.6.2')]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'current');
});

test('ta sama i starsza wersja to "current", nie "newer"', async () => {
  for (const zdalna of ['1.7.0', '1.6.1', '0.9.9']) {
    const { fetchJson } = stub([wydanie(`tibia-sounds-config-v${zdalna}`)]);
    const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'current', `dla zdalnej ${zdalna}`);
  }
});

test('nowsze wydanie bez instalatora nadal jest zglaszane, ale bez assetu', async () => {
  const { fetchJson } = stub([wydanie('tibia-sounds-config-v1.8.0', { assets: [] })]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'newer');
  assert.equal(wynik.release.asset, null);
});

test('blad sieci konczy sie "failed" z powodem, a nie wyjatkiem', async () => {
  const { fetchJson } = stub(() => { throw new Error('przekroczono limit 10000 ms'); });
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'failed');
  assert.match(wynik.error, /limit/);
});

test('odpowiedz, ktora nie jest lista, nie przechodzi jako aktualizacja', async () => {
  for (const smiec of [null, 'tekst', 42, {}, { tag_name: 'tibia-sounds-config-v9.9.9' }]) {
    const { fetchJson } = stub(smiec);
    const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'failed', `dla ${JSON.stringify(smiec)}`);
  }
});

test('poza Windowsem nie pytamy GitHuba w ogole', async () => {
  const { fetchJson, calls } = stub([wydanie('tibia-sounds-config-v9.9.9')]);
  const wynik = await fetchLatestRelease({ currentVersion: '1.7.0', fetchJson, platform: 'linux' });
  assert.equal(wynik.status, 'failed');
  assert.equal(calls.length, 0);
});

test('adresy sa przybite do https i do znanych repozytoriow', () => {
  assert.ok(RELEASES_API.startsWith('https://api.github.com/repos/Mysttic/Mysttic/'));
  assert.ok(RELEASES_PAGE.startsWith('https://github.com/Mysttic/tibia-sounds-config/'));
});
