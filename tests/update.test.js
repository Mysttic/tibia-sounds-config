'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions, parseVersion, installerNameFor, parseDigest, pickAsset,
  fetchLatestRelease, RELEASES_API, RELEASES_PAGE,
} = require('../electron/lib/update');

/**
 * Sprawdzanie aktualizacji dotyka sieci i uruchamia instalator, wiec jego czesc
 * decyzyjna jest wydzielona i testowana z podstawionym `fetchJson`. Zaden test
 * ponizej nie wychodzi do sieci.
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

/** Odpowiedz GitHuba przycieta do pol, ktorych faktycznie uzywamy. */
function wydanie(version, { assets, ...reszta } = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    body: `opis ${version}`,
    published_at: '2026-09-01T10:00:00Z',
    html_url: `https://github.com/Mysttic/tibia-sounds-config/releases/tag/v${version}`,
    assets: assets ?? [{
      name: installerNameFor(version),
      browser_download_url: `https://objects.githubusercontent.com/${version}/setup.exe`,
      size: 81_743_105,
      digest: 'sha256:4cf2dbb7824df04b5fce875ca0b09dd1279e6eb6953ac730a36cefde6bef7ada',
    }],
    ...reszta,
  };
}

test('parseVersion uzupelnia brakujace czlony i scina przyrostki', () => {
  assert.deepEqual(parseVersion('1.6.1'), [1, 6, 1]);
  assert.deepEqual(parseVersion('v1.6.1'), [1, 6, 1]);
  assert.deepEqual(parseVersion('2.0'), [2, 0, 0]);
  assert.deepEqual(parseVersion('1.7.0-rc.2'), [1, 7, 0]);
  assert.deepEqual(parseVersion('1.7.0+build9'), [1, 7, 0]);
  assert.deepEqual(parseVersion('bzdura'), [0, 0, 0]);
});

test('compareVersions porownuje liczbowo, nie tekstowo', () => {
  // Tekstowo "1.10.0" < "1.9.0", bo "1" < "9". Tu ma byc odwrotnie.
  assert.ok(compareVersions('1.9.0', '1.10.0') < 0);
  assert.ok(compareVersions('1.6.1', '1.6.0') > 0);
  assert.equal(compareVersions('1.6.1', 'v1.6.1'), 0);
  assert.equal(compareVersions('1.6.1', '1.6.1-rc.1'), 0);
});

test('parseDigest przyjmuje tylko poprawne sha256', () => {
  const ok = 'sha256:4cf2dbb7824df04b5fce875ca0b09dd1279e6eb6953ac730a36cefde6bef7ada';
  assert.equal(parseDigest(ok), ok.slice(7));
  assert.equal(parseDigest(ok.toUpperCase()), ok.slice(7));
  assert.equal(parseDigest('sha512:abc'), null);
  assert.equal(parseDigest('sha256:krotkie'), null);
  assert.equal(parseDigest(undefined), null);
});

test('pickAsset dopasowuje po dokladnej nazwie, nie po fragmencie', () => {
  const assets = [
    { name: 'tibia-sounds-config-1.7.0-win-x64-portable.exe', browser_download_url: 'https://x/p', size: 1 },
    { name: 'tibia-sounds-config-1.7.0-win-x64-setup.exe', browser_download_url: 'https://x/s', size: 2, digest: null },
    { name: 'tibia-sounds-config-1.7.0-win-x64.zip', browser_download_url: 'https://x/z', size: 3 },
  ];
  const wybrany = pickAsset(assets, installerNameFor('1.7.0'));
  assert.equal(wybrany.url, 'https://x/s');
  assert.equal(wybrany.size, 2);
  assert.equal(wybrany.sha256, null);
  assert.equal(pickAsset(assets, 'czegos-takiego-nie-ma.exe'), null);
  assert.equal(pickAsset(undefined, 'cokolwiek'), null);
});

test('nowsze wydanie zwraca komplet danych do pobrania', async () => {
  const { fetchJson, calls } = stub(wydanie('1.7.0'));
  const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'win32' });

  assert.equal(wynik.status, 'newer');
  assert.equal(wynik.release.version, '1.7.0');
  assert.equal(wynik.release.asset.name, 'tibia-sounds-config-1.7.0-win-x64-setup.exe');
  assert.equal(wynik.release.asset.sha256.length, 64);
  assert.equal(calls[0].url, RELEASES_API);
  // Bez tych naglowkow GitHub potrafi oddac starszy ksztalt odpowiedzi.
  assert.equal(calls[0].opts.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('ta sama i starsza wersja to "current", nie "newer"', async () => {
  for (const zdalna of ['1.6.1', '1.6.0', '1.5.9']) {
    const { fetchJson } = stub(wydanie(zdalna));
    const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'current', `dla zdalnej ${zdalna}`);
  }
});

test('szkic i wydanie kandydujace sa pomijane mimo wyzszego numeru', async () => {
  for (const flaga of ['draft', 'prerelease']) {
    const { fetchJson } = stub(wydanie('2.0.0', { [flaga]: true }));
    const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'current', `dla ${flaga}`);
  }
});

test('nowsze wydanie bez instalatora nadal jest zglaszane, ale bez assetu', async () => {
  // Zdarza sie, gdy build dla Windows padl, a release powstal z reszty artefaktow.
  const { fetchJson } = stub(wydanie('1.7.0', { assets: [] }));
  const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'newer');
  assert.equal(wynik.release.asset, null);
  assert.ok(wynik.release.pageUrl.startsWith('https://github.com/Mysttic/tibia-sounds-config/'));
});

test('blad sieci konczy sie "failed" z powodem, a nie wyjatkiem', async () => {
  const { fetchJson } = stub(() => { throw new Error('przekroczono limit 10000 ms'); });
  const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'win32' });
  assert.equal(wynik.status, 'failed');
  assert.match(wynik.error, /limit/);
});

test('odpowiedz o nieoczekiwanym ksztalcie nie przechodzi jako aktualizacja', async () => {
  for (const smiec of [null, 'tekst', 42, {}, { tag_name: '   ' }]) {
    const { fetchJson } = stub(smiec);
    const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'win32' });
    assert.equal(wynik.status, 'failed', `dla ${JSON.stringify(smiec)}`);
  }
});

test('poza Windowsem nie pytamy GitHuba w ogole', async () => {
  const { fetchJson, calls } = stub(wydanie('9.9.9'));
  const wynik = await fetchLatestRelease({ currentVersion: '1.6.1', fetchJson, platform: 'linux' });
  assert.equal(wynik.status, 'failed');
  assert.equal(calls.length, 0);
});

test('adresy sa przybite do naszego repozytorium i do https', () => {
  for (const url of [RELEASES_API, RELEASES_PAGE]) {
    assert.ok(url.startsWith('https://'), url);
    assert.ok(url.includes('Mysttic/tibia-sounds-config'), url);
  }
});
