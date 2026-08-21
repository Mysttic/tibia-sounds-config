'use strict';

const {
  app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen, nativeTheme,
} = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const { resolveAppVersion } = require('./lib/version');
const { listProviders, getProvider } = require('./lib/providers');
const { downloadToTemp, assertHttps } = require('./lib/net');
const { buildBundle, applyBundle } = require('./lib/portable');
const { validateClientDir, autodetect } = require('./lib/clientPaths');
const { buildCatalog } = require('./lib/catalog');
const { detectFfmpeg, SUPPORTED_INPUT } = require('./lib/audio');
const { probeClients, isClientRunning } = require('./lib/processes');
const { PreviewStore, resolveTsound } = require('./lib/tsound');
const { listGenerators, getGenerator } = require('./lib/generate');
const { SecretStore } = require('./lib/secrets');
const { SoundLibrary } = require('./lib/library');
const {
  vaultForClient, loadProfile, applySound, resetSound, reapplyDrifted, applyPreset,
  writeTextAtomic,
} = require('./lib/profile');
const {
  PresetStore, resolvePreset, planChanges, presetFromState,
} = require('./lib/presets');

const SCHEME = 'tsound';

// Custom scheme musi byc zarejestrowany zanim app bedzie gotowe.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// --- stan procesu glownego -------------------------------------------------

const state = {
  client: null,      // wynik validateClientDir
  vault: null,
  profile: null,
  catalog: null,
  ffmpeg: null,
};

// Numer z VERSION.md; app.getVersion() (czyli package.json) tylko jako zapasowy.
// CI pilnuje, zeby oba byly rowne - patrz `npm run version:check`.
const APP_VERSION = resolveAppVersion(app.getVersion());
const WINDOW_TITLE = `Tibia Sounds Config v${APP_VERSION}`;

// Klucz -> zewnetrzny URL podgladu.
//
// Renderer dostaje w wynikach wyszukiwania rowniez `audioUrl` (uzywa go web:apply),
// ale NIE laczy sie z nim sam: odsluch idzie przez tsound://preview/<klucz>, wiec
// CSP okna moze zostac zamkniete (media-src tsound:), a caly ruch wychodzi stad.
// Pamiec jest ograniczona, zeby adresy z dawnych wyszukiwan nie zostawaly
// pobieralne do konca zycia procesu.
const previews = new PreviewStore();
const PREVIEW_UA = 'tibia-sounds-config (+https://github.com/Mysttic/tibia-sounds-config)';
const previewKey = (url) => require('node:crypto').createHash('sha1').update(url).digest('hex');

let win = null;

// Klucze API dostawcow generowania. Osobny plik od settings.json, zaszyfrowany
// przez safeStorage - patrz lib/secrets.js.
let secrets = null;

function secretStore() {
  if (!secrets) secrets = new SecretStore(path.join(app.getPath('userData'), 'secrets.json'));
  return secrets;
}

/**
 * Biblioteka wygenerowanych dzwiekow. Raz wygenerowany dzwiek zostaje na dysku
 * i da sie go uzyc pod dowolny wpis, takze po zmianie wersji klienta.
 */
let soundLibrary = null;

// Ponad to nie kopiujemy pliku z dysku do biblioteki - podmiana i tak sie uda,
// po prostu nie zostawiamy kopii cudzego albumu w katalogu aplikacji.
const LIBRARY_MAX_BYTES = 25 * 1024 * 1024;

function library() {
  if (!soundLibrary) soundLibrary = new SoundLibrary(path.join(app.getPath('userData'), 'generated'));
  return soundLibrary;
}

let presets = null;

function presetStore() {
  if (!presets) presets = new PresetStore(path.join(app.getPath('userData'), 'presets.json'));
  return presets;
}

/** Podaje zestawom dostep do biblioteki: id -> { path, name, origin } albo null. */
async function libraryLookup(id) {
  const file = await library().filePath(id);
  if (!file) return null;
  const item = (await library().list()).find((i) => i.id === id);
  return { path: file, name: item ? item.name : 'dzwiek z biblioteki', origin: item && item.origin };
}

function vaultRoot() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'vault')
    : path.join(__dirname, '..', 'vault');
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    return JSON.parse(await fsp.readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

// Zapisy ustawien sa szeregowane, bo to read-modify-write: zapis geometrii okna
// w tej samej chwili co zapis clientDir gubilby jedna ze zmian.
let settingsQueue = Promise.resolve();

async function writeSettings(patch) {
  const run = settingsQueue.then(async () => {
    const current = await readSettings();
    const next = { ...current, ...patch };
    await fsp.mkdir(path.dirname(settingsFile()), { recursive: true });
    await writeTextAtomic(settingsFile(), JSON.stringify(next, null, 2));
    return next;
  });
  settingsQueue = run.catch(() => {});
  return run;
}

function progress(done, total, label = null) {
  if (win && !win.isDestroyed()) win.webContents.send('catalog:progress', { done, total, label });
}

function clearClient() {
  state.client = null;
  state.vault = null;
  state.profile = null;
  state.catalog = null;
}

/**
 * Wczytuje klienta: bank + enumy + statusy.
 *
 * Wszystko powstaje w zmiennych lokalnych i dopiero komplet ladujemy do `state`.
 * Inaczej nieudane wczytanie (uszkodzony .dat, brak uprawnien) zostawialoby
 * `state.client` z nowej instalacji i katalog opisujacy poprzednia - a wtedy zapis
 * poszedlby z nazwami plikow z niewlasciwego klienta.
 */
async function useClient(dir) {
  const client = await validateClientDir(dir);
  if (!client.ok) throw new Error(client.reason);

  const vault = vaultForClient(vaultRoot(), client.root);
  const profile = await loadProfile(vault, client.root);
  const catalog = await buildCatalog({
    soundsDir: client.soundsDir,
    clientExe: client.clientExe,
    profile,
    cacheFile: vault.cacheFile,
    onProgress: progress,
  });

  state.client = client;
  state.vault = vault;
  state.profile = profile;
  state.catalog = catalog;

  await writeSettings({ clientDir: client.root });
  return publicState();
}

async function refreshCatalog() {
  if (!state.client) return publicState();
  state.catalog = await buildCatalog({
    soundsDir: state.client.soundsDir,
    clientExe: state.client.clientExe,
    profile: state.profile,
    cacheFile: state.vault.cacheFile,
    onProgress: progress,
  });
  return publicState();
}

function publicState() {
  return {
    appVersion: APP_VERSION,
    client: state.client && {
      root: state.client.root,
      soundsDir: state.client.soundsDir,
      version: state.client.version,
      hasExe: Boolean(state.client.clientExe),
    },
    ffmpeg: state.ffmpeg,
    catalog: state.catalog && {
      entries: state.catalog.entries,
      counts: state.catalog.counts,
      datFile: state.catalog.datFile,
      enumSource: state.catalog.enumSource,
    },
    vaultDir: state.vault ? state.vault.dir : null,
    supportedInput: SUPPORTED_INPUT,
    theme: nativeTheme.themeSource,
  };
}

/**
 * Przyciski eksportu, importu i "Zastosuj ponownie" sa aktywne zawsze. Bez tego
 * sprawdzenia siegaly do state.vault / state.catalog rownych null i uzytkownik
 * dostawal surowe "Cannot read properties of null" - w dodatku dopiero po przejsciu
 * przez okno wyboru pliku.
 */
function assertClientLoaded() {
  if (!state.client || !state.vault || !state.catalog) {
    throw new Error('najpierw wskaz katalog klienta Tibii (przycisk "Zmien...")');
  }
}

function entryById(soundId) {
  const found = state.catalog && state.catalog.entries.find((e) => e.soundId === soundId);
  if (!found) throw new Error(`nie znam dzwieku o id ${soundId}`);
  return found;
}

/**
 * Bramka przed kazdym zapisem do plikow gry.
 *
 * Gdy wykrycie procesow sie nie powiedzie, odmawiamy zapisu zamiast zakladac,
 * ze gra jest zamknieta. Wczesniej blad `tasklist` byl cicho traktowany jak
 * "klient nie dziala" i przepuszczal zapis przy uruchomionej grze.
 */
async function assertClientClosed() {
  const probe = await probeClients();
  if (!probe.ok) {
    throw new Error(
      'nie udalo sie sprawdzic, czy klient Tibii jest uruchomiony, wiec wstrzymuje zapis. ' +
      `Zamknij gre i sprobuj ponownie. Szczegoly: ${probe.error}`
    );
  }
  if (probe.names.length > 0) {
    throw new Error('Klient Tibii jest uruchomiony. Zamknij go przed podmiana plikow.');
  }
}

// --- IPC -------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:state', async () => publicState());

  ipcMain.handle('app:init', async () => {
    state.ffmpeg = await detectFfmpeg();
    const settings = await readSettings();
    let target = settings.clientDir;
    if (!target) {
      const auto = await autodetect();
      target = auto ? auto.root : null;
    }
    if (target) {
      try {
        await useClient(target);
      } catch {
        clearClient(); // zapisana sciezka przestala byc poprawna
      }
    }
    return { ...publicState(), warningAccepted: Boolean(settings.warningAccepted) };
  });

  // ffmpeg mogl zostac zainstalowany juz po starcie aplikacji - bez tego kanalu
  // uzytkownik do konca sesji widzialby komunikat "zainstaluj ffmpeg".
  ipcMain.handle('app:detectFfmpeg', async () => {
    state.ffmpeg = await detectFfmpeg();
    return state.ffmpeg;
  });

  ipcMain.handle('app:acceptWarning', async () => {
    await writeSettings({ warningAccepted: true });
    return true;
  });

  // Wyglad: 'system' podaza za Windowsem, 'light'/'dark' wymusza jeden z motywow.
  // Wybor zostaje w settings.json i jest przywracany przy starcie.
  ipcMain.handle('app:setTheme', async (_e, { source }) => {
    if (!THEME_SOURCES.includes(source)) throw new Error(`nieznany motyw: ${source}`);
    nativeTheme.themeSource = source;
    if (win && !win.isDestroyed()) win.setBackgroundColor(surfaceColor());
    await writeSettings({ theme: source });
    return { theme: source, dark: nativeTheme.shouldUseDarkColors };
  });

  ipcMain.handle('client:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Wskaz katalog klienta Tibii',
      properties: ['openDirectory'],
      defaultPath: state.client ? state.client.root : undefined,
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return useClient(res.filePaths[0]);
  });

  ipcMain.handle('catalog:refresh', async () => refreshCatalog());

  ipcMain.handle('audio:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Wybierz plik audio',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: SUPPORTED_INPUT.map((e) => e.slice(1)) },
        { name: 'Wszystkie pliki', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('sound:replace', async (_e, { soundId, srcPath, quality }) => {
    await assertClientClosed();
    const entry = entryById(soundId);
    await applySound({
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
      entryInfo: { soundId, file: entry.file },
      srcPath,
      mode: 'replace',
      quality: quality ?? 5,
    });
    return refreshCatalog();
  });

  ipcMain.handle('sound:mute', async (_e, { soundId }) => {
    await assertClientClosed();
    const entry = entryById(soundId);
    await applySound({
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
      entryInfo: { soundId, file: entry.file },
      mode: 'mute',
    });
    return refreshCatalog();
  });

  ipcMain.handle('sound:reset', async (_e, { soundId }) => {
    await assertClientClosed();
    const entry = entryById(soundId);
    await resetSound({
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
      fileName: entry.file,
      soundId,
    });
    return refreshCatalog();
  });

  ipcMain.handle('profile:reapply', async () => {
    assertClientLoaded();
    await assertClientClosed();
    const results = await reapplyDrifted({
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
      entries: state.catalog.entries,
    });
    const next = await refreshCatalog();
    return { results, state: next };
  });

  ipcMain.handle('profile:export', async () => {
    assertClientLoaded();
    const res = await dialog.showSaveDialog(win, {
      title: 'Zapisz profil z dzwiekami',
      defaultPath: `tibia-sounds-profile-${APP_VERSION}.json`,
      filters: [{ name: 'Profil Tibia Sounds Config', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;

    const { bundle, bytes, skipped } = await buildBundle({
      vault: state.vault,
      profile: state.profile,
      appVersion: APP_VERSION,
      clientVersion: state.client && state.client.version,
    });
    await fsp.writeFile(res.filePath, JSON.stringify(bundle));
    return {
      path: res.filePath,
      liczba: bundle.entries.length,
      bytes,
      skipped,
    };
  });

  ipcMain.handle('profile:import', async () => {
    assertClientLoaded();
    const res = await dialog.showOpenDialog(win, {
      title: 'Wczytaj profil',
      properties: ['openFile'],
      filters: [{ name: 'Profil Tibia Sounds Config', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;

    await assertClientClosed();
    let bundle;
    try {
      bundle = JSON.parse(await fsp.readFile(res.filePaths[0], 'utf8'));
    } catch {
      throw new Error('nie udalo sie odczytac pliku - czy to na pewno profil?');
    }

    const wynik = await applyBundle({
      bundle,
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
    });
    const next = await refreshCatalog();
    return { ...wynik, state: next };
  });

  ipcMain.handle('shell:revealSound', async (_e, { soundId }) => {
    const entry = entryById(soundId);
    shell.showItemInFolder(path.join(state.client.soundsDir, entry.file));
    return true;
  });

  ipcMain.handle('shell:openVault', async () => {
    if (!state.vault) return false;
    await fsp.mkdir(state.vault.dir, { recursive: true });
    shell.openPath(state.vault.dir);
    return true;
  });

  ipcMain.handle('client:running', async () => isClientRunning());

  // Zrzut okna do dokumentacji. Tylko w trybie deweloperskim - w wersji spakowanej
  // handler nie istnieje, wiec nie da sie go wywolac.
  if (!app.isPackaged) {
    ipcMain.handle('debug:capture', async (_e, { outPath }) => {
      // Przesloniete okno przestaje malowac i capturePage zwraca pusty obraz -
      // najpierw wyciagamy je na wierzch i dajemy chwile na przerysowanie.
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      await new Promise((r) => setTimeout(r, 500));
      const image = await win.webContents.capturePage();
      const target = path.resolve(__dirname, '..', outPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, image.toPNG());
      return { path: target, bytes: image.toPNG().length };
    });

  }

  // --- wyszukiwanie w sieci -------------------------------------------------
  // Caly ruch sieciowy idzie stad, nigdy z renderera, i tylko po kliknieciu uzytkownika.

  ipcMain.handle('web:providers', async () => {
    const settings = await readSettings();
    return listProviders(settings.customProviders || []).map((p) => ({
      id: p.id,
      name: p.name,
      builtin: p.builtin,
      description: p.description,
      homepage: p.homepage,
    }));
  });

  ipcMain.handle('web:search', async (_e, { providerId, query, limit }) => {
    if (!query || !query.trim()) throw new Error('podaj czego szukac');
    const settings = await readSettings();
    const provider = getProvider(providerId, settings.customProviders || []);
    const found = await provider.search(query.trim(), { limit: limit || 20 });
    // Kazdy wynik dostaje wlasny identyfikator podgladu - renderer nie widzi URL-i.
    for (const r of found.results) {
      r.previewKey = previews.remember(r.audioUrl, previewKey(r.audioUrl));
    }
    return found;
  });

  ipcMain.handle('web:apply', async (_e, { soundId, result }) => {
    await assertClientClosed();
    const entry = entryById(soundId);
    assertHttps(result.audioUrl);

    const dl = await downloadToTemp(result.audioUrl);
    try {
      await applySound({
        soundsDir: state.client.soundsDir,
        vault: state.vault,
        profile: state.profile,
        entryInfo: { soundId, file: entry.file },
        srcPath: dl.path,
        mode: 'replace',
        source: result,
      });
    } finally {
      await fsp.rm(dl.dir, { recursive: true, force: true });
    }
    return refreshCatalog();
  });

  // --- generowanie dzwieku --------------------------------------------------
  // Aplikacja nie ma wlasnego klucza i za nic nie placi. Klucz uzytkownika lezy
  // zaszyfrowany i nigdy nie opuszcza tego procesu - renderer dowiaduje sie
  // wylacznie, czy klucz jest ustawiony.

  ipcMain.handle('gen:providers', async () => {
    const store = secretStore();
    const list = listGenerators();
    return Promise.all(list.map(async (g) => ({ ...g, hasKey: await store.has(g.id) })));
  });

  ipcMain.handle('gen:setKey', async (_e, { providerId, key }) => {
    getGenerator(providerId); // odrzuca nieznane id, zanim cokolwiek zapiszemy
    await secretStore().set(providerId, key);
    return true;
  });

  ipcMain.handle('gen:clearKey', async (_e, { providerId }) => secretStore().clear(providerId));

  // Wygenerowany dzwiek od razu trafia do biblioteki - nie ginie przy zamknieciu
  // aplikacji i da sie go pozniej uzyc pod inny wpis.
  ipcMain.handle('gen:generate', async (_e, { providerId, prompt, options }) => {
    const generator = getGenerator(providerId);
    const key = await secretStore().get(providerId);
    if (!key) throw new Error(`najpierw zapisz klucz API dla: ${generator.name}`);

    const made = await generator.generate(prompt, { ...(options || {}), key });
    try {
      return library().add({
        srcPath: made.path,
        contentType: made.contentType,
        name: made.title,
        prompt,
        origin: made.origin,
        durationSec: (options && options.durationSec) || null,
        size: made.size,
      });
    } finally {
      await fsp.rm(made.dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // --- biblioteka -----------------------------------------------------------

  // --- zestawy dzwiekow -----------------------------------------------------

  ipcMain.handle('preset:list', async () => presetStore().list());

  /** Co by sie stalo po zastosowaniu - liczby do potwierdzenia, bez zapisu. */
  ipcMain.handle('preset:plan', async (_e, { id }) => {
    assertClientLoaded();
    const preset = await presetStore().get(id);
    const plan = resolvePreset(preset, state.catalog.entries);
    const { doZrobienia, bezZmian, problemy } = planChanges(plan, state.catalog.entries);
    return {
      name: preset.name,
      doZmiany: doZrobienia.length,
      bezZmian,
      problemy,
      wycisza: doZrobienia.filter((c) => c.action === 'mute').length,
      przywraca: doZrobienia.filter((c) => c.action === 'original').length,
      podmienia: doZrobienia.filter((c) => typeof c.action === 'object').length,
    };
  });

  ipcMain.handle('preset:apply', async (_e, { id }) => {
    assertClientLoaded();
    await assertClientClosed();
    const preset = await presetStore().get(id);
    const plan = resolvePreset(preset, state.catalog.entries);
    const { doZrobienia, bezZmian, problemy } = planChanges(plan, state.catalog.entries);

    const wynik = await applyPreset({
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
      entries: state.catalog.entries,
      changes: doZrobienia,
      libraryDir: libraryLookup,
      onProgress: (done, total) => progress(done, total, 'Wgrywam zestaw'),
      // Wgrywanie kilkuset plikow trwa, wiec bramka nie moze dzialac tylko na starcie:
      // gdy gra wstanie w trakcie, przerywamy zamiast pisac pod dzialajacym klientem.
      shouldContinue: async () => {
        const probe = await probeClients();
        return probe.ok && probe.names.length === 0;
      },
    });

    const next = await refreshCatalog();
    return {
      ...wynik,
      name: preset.name,
      bezZmian,
      problemy: [...problemy, ...wynik.bledy],
      state: next,
    };
  });

  ipcMain.handle('preset:saveCurrent', async (_e, { name }) => {
    assertClientLoaded();
    return presetStore().add(presetFromState(name, state.catalog.entries));
  });

  ipcMain.handle('preset:rename', async (_e, { id, name }) => presetStore().rename(id, name));

  ipcMain.handle('preset:remove', async (_e, { id }) => presetStore().remove(id));

  ipcMain.handle('lib:list', async () => library().list());

  /**
   * Wciaga plik z dysku do biblioteki, zeby dal sie uzyc ponownie bez szukania go
   * w systemie. Duze pliki pomijamy - biblioteka ma byc podreczna polka, nie kopia
   * czyjejs kolekcji muzyki. Zwraca null, gdy pliku nie warto trzymac.
   */
  ipcMain.handle('lib:import', async (_e, { srcPath }) => {
    const ext = path.extname(srcPath).toLowerCase();
    if (!SUPPORTED_INPUT.includes(ext)) return null;

    const stat = await fsp.stat(srcPath).catch(() => null);
    if (!stat || !stat.isFile()) return null;
    if (stat.size > LIBRARY_MAX_BYTES) return null;

    return library().add({
      srcPath,
      ext,
      kind: 'disk',
      fileName: path.basename(srcPath),
      size: stat.size,
    });
  });

  ipcMain.handle('lib:rename', async (_e, { id, name }) => library().rename(id, name));

  ipcMain.handle('lib:remove', async (_e, { id }) => library().remove(id));

  ipcMain.handle('lib:apply', async (_e, { soundId, id }) => {
    assertClientLoaded();
    await assertClientClosed();
    const file = await library().filePath(id);
    if (!file) throw new Error('nie ma takiego dzwieku w bibliotece');
    const items = await library().list();
    const item = items.find((i) => i.id === id);
    const entry = entryById(soundId);

    await applySound({
      soundsDir: state.client.soundsDir,
      vault: state.vault,
      profile: state.profile,
      entryInfo: { soundId, file: entry.file },
      srcPath: file,
      mode: 'replace',
      // Nazwa z biblioteki jest tym, co uzytkownik nada sam - lepiej opisuje
      // podmianke w tabeli niz surowy prompt. `libraryId` pozwala zestawom
      // rozpoznac, ze ten dzwiek pochodzi wlasnie stad.
      source: { ...(item.origin || {}), title: item.name, libraryId: item.id },
    });
    return refreshCatalog();
  });

  ipcMain.handle('web:applyUrl', async (_e, { soundId, url }) => {
    await assertClientClosed();
    const entry = entryById(soundId);
    assertHttps(url);

    const dl = await downloadToTemp(url);
    try {
      await applySound({
        soundsDir: state.client.soundsDir,
        vault: state.vault,
        profile: state.profile,
        entryInfo: { soundId, file: entry.file },
        srcPath: dl.path,
        mode: 'replace',
        source: { title: decodeURIComponent(url.split('/').pop() || 'link'), audioUrl: url, providerId: 'link' },
      });
    } finally {
      await fsp.rm(dl.dir, { recursive: true, force: true });
    }
    return refreshCatalog();
  });
}

// --- protokol tsound:// ----------------------------------------------------

/**
 * Rozstrzyganie adresow siedzi w lib/tsound.js jako czysta funkcja - tutaj zostaje
 * samo pobranie zasobu. Opis schematu i zasad bezpieczenstwa jest tam.
 */
function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const res = resolveTsound(request.url, {
        client: state.client,
        vault: state.vault,
        previews,
      });
      if (res.error) return new Response(res.error, { status: res.status });
      if (res.kind === 'preview') {
        return net.fetch(res.url, { headers: { 'User-Agent': PREVIEW_UA } });
      }
      if (res.kind === 'library') {
        // Sciezke zna wylacznie biblioteka i wylacznie dla id z wlasnego spisu.
        const file = await library().filePath(res.id);
        if (!file) return new Response('nieznany dzwiek z biblioteki', { status: 404 });
        return net.fetch(pathToFileURL(file).toString());
      }
      return net.fetch(pathToFileURL(res.file).toString());
    } catch (err) {
      return new Response(String(err && err.message), { status: 500 });
    }
  });
}

// --- okno ------------------------------------------------------------------

// Najwezsze okno, w ktorym tabela miesci sie bez przewijania w poziomie.
// Suma `min` kolumn domyslnych z COLUMNS w renderer/app.js: 190 (nazwa) + 100 (kategoria)
// + 66 (dlugosc) + 176 (akcje) = 532 px, plus margines na ramke i suwak.
// Kolumny techniczne sa opcjonalne i po ich wlaczeniu tabela moze sie przewijac.
const MIN_WINDOW_WIDTH = 580;

/**
 * Domyslnie okno zajmuje lewa polowe ekranu na pelna wysokosc obszaru roboczego.
 * Przy waskich ekranach polowa bylaby za mala na tabele, wiec schodzimy do
 * MIN_WINDOW_WIDTH (a gdy i to nie wchodzi - do calej szerokosci pulpitu).
 */
function halfScreenBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const half = Math.round(workArea.width / 2);
  const width = Math.min(workArea.width, Math.max(half, MIN_WINDOW_WIDTH));
  return { x: workArea.x, y: workArea.y, width, height: workArea.height };
}

/**
 * Zapamietane polozenie okna przyjmujemy tylko wtedy, gdy nadal miesci sie na
 * ktoryms z podlaczonych ekranow - inaczej po odlaczeniu drugiego monitora okno
 * otwieraloby sie poza widocznym obszarem.
 */
function usableBounds(saved) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;
  if (saved.width < 320 || saved.height < 240) return null;

  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    // wystarczy, ze widoczny jest sensowny kawalek paska tytulu
    return saved.x + saved.width > a.x + 40
      && saved.x < a.x + a.width - 40
      && saved.y + 30 > a.y
      && saved.y < a.y + a.height - 30;
  });
  return visible ? saved : null;
}

let boundsTimer = null;

function saveBoundsNow() {
  if (!win || win.isDestroyed()) return;
  // Zmaksymalizowane okno ma bounds calego ekranu - do zapamietania chcemy rozmiar,
  // do ktorego wroci po przywroceniu.
  const bounds = win.isMaximized() || win.isMinimized() ? win.getNormalBounds() : win.getBounds();
  writeSettings({ windowBounds: bounds, windowMaximized: win.isMaximized() }).catch(() => {});
}

/** Przeciaganie okna sypie zdarzeniami co klatke - zapisujemy dopiero po chwili spokoju. */
function rememberBounds() {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(saveBoundsNow, 400);
}

// Kolor tla okna zanim renderer zdazy sie narysowac - musi zgadzac sie z
// --surface-0 z renderer/styles.css, zeby przy starcie nie mrugalo drugim kolorem.
const SURFACE_0 = { dark: '#111010', light: '#faf9f7' };
const THEME_SOURCES = ['system', 'light', 'dark'];

function surfaceColor() {
  return nativeTheme.shouldUseDarkColors ? SURFACE_0.dark : SURFACE_0.light;
}

function createWindow(settings = {}) {
  const bounds = usableBounds(settings.windowBounds) || halfScreenBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(MIN_WINDOW_WIDTH, bounds.width),
    minHeight: 480,
    backgroundColor: surfaceColor(),
    title: WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Bez tego przesloniete okno przestaje sie odswiezac, a odtwarzanie
      // i zrzuty ekranu zachowuja sie nieprzewidywalnie.
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  // Bez tego <title> ze strony nadpisalby tytul okna i zjadl numer wersji.
  win.on('page-title-updated', (event) => event.preventDefault());

  // Utwardzenie: renderer nie ma linkow ani nawigacji, wiec kazda proba otwarcia
  // okna albo przejscia pod inny adres oznacza, ze cos poszlo nie tak.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (settings.windowMaximized) win.maximize();
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('maximize', rememberBounds);
  win.on('unmaximize', rememberBounds);
  // Przy zamykaniu nie ma juz na co czekac - zapisujemy od razu.
  win.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    saveBoundsNow();
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Renderer przelacza sie sam przez prefers-color-scheme; tutaj zostaje tylko
// kolor tla okna, ktory nie jest czescia strony.
nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) win.setBackgroundColor(surfaceColor());
});

// Druga instancja wskazujaca tego samego klienta trzymalaby wlasny profil w pamieci
// i przy zapisie skasowala podmianki zrobione w pierwszej. Zamiast tego wyciagamy
// na wierzch okno, ktore juz dziala.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    const settings = await readSettings();
    // Motyw ustawiamy przed otwarciem okna, zeby jego tlo od razu bylo wlasciwe.
    if (THEME_SOURCES.includes(settings.theme)) nativeTheme.themeSource = settings.theme;
    registerProtocol();
    registerIpc();
    createWindow(settings);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(settings);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
