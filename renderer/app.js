'use strict';

/* global api */

const el = (id) => document.getElementById(id);

const ui = {
  btnClient: el('btnClient'),
  clientLabel: el('clientLabel'),
  btnMenu: el('btnMenu'),
  menu: el('menu'),
  rowMenu: el('rowMenu'),
  banners: el('banners'),
  bar: el('bar'),
  barFill: el('barFill'),
  q: el('q'),
  cat: el('cat'),
  chips: el('chips'),
  vol: el('vol'),
  grid: el('grid'),
  cg: el('cg'),
  hr: el('hr'),
  tb: el('tb'),
  empty: el('empty'),
  msg: el('msg'),
  warning: el('warning'),
  about: el('about'),
};

const audio = new Audio();

let entries = [];
let state = null;
let sortKey = 'event';
let sortDesc = false;
let playing = null;      // { soundId, variant }
let busy = false;
let flashId = null;      // wiersz do podswietlenia po najblizszym renderze
let statusFilter = '';   // aktywny chip statusu

const STATUS_LABEL = {
  original: 'oryginal',
  replaced: 'moje podmianki',
  drifted: 'nadpisane przez Tibie',
  foreign: 'zmienione poza aplikacja',
  missing: 'brak pliku',
  unknown: 'nieznany',
};

// ---------- formatowanie ----------

function fmtSize(b) {
  if (!b) return '-';
  return b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} kB`;
}

/** Setne czesci sekundy nie zmieniaja zadnej decyzji - wystarcza dziesiate. */
function fmtDur(s) {
  if (!s) return '-';
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Polska odmiana przez liczebnik: 1 dzwiek, 2-4 dzwieki, 5+ dzwiekow,
 * z wyjatkiem nastek (12-14), ktore ida jak 5+.
 */
function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10;
  const s = n % 100;
  return d >= 2 && d <= 4 && !(s >= 12 && s <= 14) ? few : many;
}

const SOUNDS = (n) => plural(n, 'dzwiek', 'dzwieki', 'dzwiekow');

function say(text, kind = '') {
  ui.msg.textContent = text;
  ui.msg.className = `msg ${kind}`;
}

/**
 * Electron opakowuje kazdy blad z procesu glownego w
 * "Error invoking remote method 'sound:replace': Error: <tresc>".
 * Uzytkownikowi zostawiamy sama tresc - komunikaty w main.js sa pisane dla niego.
 */
function humanError(err) {
  const raw = (err && err.message) || String(err);
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Uncaught )?(Error|TypeError):\s*/, '')
    .trim() || 'nieznany blad';
}

/** Nazwa pliku to sound- + 64 znaki hasha. Pelna wersje zostawiamy w tooltipie. */
const FILE_LONG = /^sound-([0-9a-f]{12})[0-9a-f]{52}\.ogg$/i;

function shortFile(name) {
  const m = FILE_LONG.exec(name);
  return m ? `sound-${m[1]}….ogg` : name;
}

/** Nazwa dzwieku w komunikatach - id tylko wtedy, gdy nie ma czego pokazac. */
function nameOf(entry) {
  return (entry.events && entry.events[0]) || `dzwiek #${entry.soundId}`;
}

// ---------- kolumny ----------

/**
 * Kolumny sa definiowane tutaj, a nie w index.html, bo czesc z nich pokazuje sie
 * wylacznie po wlaczeniu "szczegolow technicznych". Kazda komorka dostaje
 * `data-col`, dzieki czemu testy i skrypty czytaja ja po nazwie, a nie po indeksie -
 * inaczej kazde dodanie kolumny po cichu przesuwalo odczyty.
 *
 * `min`   - ponizej tego kolumna przestaje byc czytelna
 * `max`   - gorna granica przy dopasowaniu automatycznym
 * `flex`  - dostaje nadmiar wolnego miejsca
 * `rigid` - szerokosc stala, tresc sie nie skaluje (przyciski)
 * `tech`  - widoczna tylko w trybie szczegolow technicznych
 * `extra` - zapas doliczany przy pomiarze (ramki, kropka statusu)
 */
const COLUMNS = [
  {
    key: 'event',
    label: 'Dzwiek w grze',
    min: 190,
    max: 620,
    flex: true,
    extra: 18,
    cell: (e) => {
      const dot = e.status === 'original' ? ''
        : `<span class="dot status-${e.status}" title="${esc(STATUS_LABEL[e.status] || e.status)}">&#9679;</span>`;
      const stream = e.isStream ? ' <span class="stream">[dlugi]</span>' : '';
      const src = e.profile ? `<span class="src">&larr; ${esc(e.profile.sourceName)}</span>` : '';
      return `${dot}${esc(nameOf(e))}${stream}${src}`;
    },
    lines: (e) => {
      const head = nameOf(e) + (e.isStream ? ' [dlugi]' : '');
      return e.profile ? [head, `← ${e.profile.sourceName}`] : [head];
    },
    // Nazwane akcje przed wygenerowanymi etykietami - inaczej pierwszy ekran to
    // sciana wpisow "ambience_stream #2651", czyli najmniej uzyteczna czesc listy.
    sort: (e) => `${e.named ? '0' : '1'} ${nameOf(e)}`,
  },
  {
    key: 'category',
    label: 'Kategoria',
    min: 100,
    max: 210,
    cls: 'cat',
    cell: (e) => esc(e.categories.join(', ')),
    lines: (e) => [e.categories.join(', ')],
    sort: (e) => e.categories.join(', '),
  },
  {
    key: 'durationSec',
    label: 'Dlugosc',
    min: 66,
    max: 100,
    cls: 'num',
    cell: (e) => fmtDur(e.durationSec),
    lines: (e) => [fmtDur(e.durationSec)],
    sort: (e) => e.durationSec,
  },
  {
    key: 'ref',
    label: 'Ref',
    min: 78,
    max: 150,
    tech: true,
    cls: 'ref',
    cell: (e) => esc(e.refs.join(', ')),
    lines: (e) => [e.refs.join(', ')],
    sort: (e) => e.refs.join(', '),
  },
  {
    key: 'soundId',
    label: 'Id',
    min: 46,
    max: 70,
    tech: true,
    cls: 'num',
    cell: (e) => e.soundId,
    lines: (e) => [String(e.soundId)],
    sort: (e) => e.soundId,
  },
  {
    key: 'file',
    label: 'Plik',
    min: 84,
    max: 300,
    tech: true,
    cls: 'file',
    cell: (e) => `<span title="${esc(e.file)}">${esc(shortFile(e.file))}</span>`,
    lines: (e) => [shortFile(e.file)],
    sort: (e) => e.file,
  },
  {
    key: 'size',
    label: 'Rozmiar',
    min: 68,
    max: 100,
    tech: true,
    cls: 'num',
    cell: (e) => fmtSize(e.size),
    lines: (e) => [fmtSize(e.size)],
    sort: (e) => e.size,
  },
  {
    key: 'acts',
    label: 'Akcje',
    min: 176,
    rigid: true,
    cls: 'acts',
    // Przyciski renderuja sie tylko tam, gdzie cos robia. Wyszarzone kontrolki
    // w 843 z 844 wierszy ucza ignorowac caly rzadek - razem z tymi dzialajacymi.
    cell: (e) => {
      const out = [
        '<button class="icon" data-a="play" title="Odtworz (Esc zatrzymuje)">&#9654;</button>',
        '<button class="act" data-a="replace" title="Podmien ten dzwiek">Podmien</button>',
      ];
      if (e.status === 'replaced' || e.status === 'drifted') {
        out.push('<button class="icon" data-a="playOrig" title="Odtworz oryginal (A/B)">&#9654;<sub>o</sub></button>');
      }
      if (e.status !== 'original') {
        out.push('<button class="icon" data-a="reset" title="Przywroc oryginal">&#8634;</button>');
      }
      return out.join('');
    },
    lines: () => [],
  },
];

let showTech = false;

function activeColumns() {
  return COLUMNS.filter((c) => showTech || !c.tech);
}

// ---------- filtrowanie i sortowanie ----------

function visible() {
  const term = ui.q.value.trim().toLowerCase();
  const cat = ui.cat.value;
  return entries.filter((e) => {
    if (cat && !e.categories.includes(cat)) return false;
    if (statusFilter && e.status !== statusFilter) return false;
    if (!term) return true;
    // Indeks celowo waski: nazwa akcji, kategoria, id i zrodlo podmianki. Ref i nazwa
    // pliku wypadly razem ze swoimi kolumnami - inaczej wyszukiwarka trafialaby
    // w wiersze, w ktorych szukanego tekstu nie widac golym okiem.
    const hay = [
      e.events.join(' '), e.categories.join(' '), e.soundId,
      e.profile ? e.profile.sourceName : '',
    ].join(' ').toLowerCase();
    return hay.includes(term);
  });
}

function sortValue(entry) {
  const col = COLUMNS.find((c) => c.key === sortKey);
  return col && col.sort ? col.sort(entry) : entry[sortKey];
}

// ---------- render ----------

function buildHead() {
  const active = activeColumns();
  ui.cg.innerHTML = active.map((c) => `<col data-col="${c.key}">`).join('');
  ui.hr.innerHTML = active.map((c) => {
    const sorted = sortKey === c.key ? ` sorted${sortDesc ? ' desc' : ''}` : '';
    const plain = c.rigid ? ' plain' : '';
    const k = c.rigid ? '' : ` data-k="${c.key}"`;
    return `<th data-col="${c.key}"${k} class="${c.cls === 'num' ? 'num' : ''}${plain}${sorted}">`
      + `<span class="label">${esc(c.label)}</span></th>`;
  }).join('');
  columnFonts.cache = {};
  wireHeaders();
}

function rowHtml(e) {
  const cells = activeColumns()
    .map((c) => `<td data-col="${c.key}"${c.cls ? ` class="${c.cls}"` : ''}>${c.cell(e)}</td>`)
    .join('');
  return `<tr data-id="${e.soundId}" data-status="${e.status}">${cells}</tr>`;
}

function render() {
  const rows = visible().sort((a, b) => {
    const x = sortValue(a);
    const y = sortValue(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sortDesc ? -c : c;
  });

  ui.tb.innerHTML = rows.map(rowHtml).join('');
  ui.empty.hidden = rows.length > 0;
  if (!rows.length) ui.empty.innerHTML = emptyHtml();

  if (flashId !== null) {
    const changed = ui.tb.querySelector(`tr[data-id="${flashId}"]`);
    if (changed) changed.classList.add('flash');
    flashId = null;
  }

  renderChips(rows.length);
  if (playing) markPlaying(playing.soundId, playing.variant);
  if (autoColumns) fitColumns();
}

/**
 * Liczniki statusow sa jednoczesnie filtrami. Pokazujemy tylko te, ktore realnie
 * wystepuja - na swiezej instalacji sa dwa, wiec lista szesciu opcji w selekcie
 * gwarantowala cztery puste wyniki.
 */
function renderChips(widoczne) {
  const counts = entries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});

  const chips = [];
  for (const key of ['replaced', 'drifted', 'foreign', 'missing']) {
    if (!counts[key]) continue;
    const on = statusFilter === key ? ' on' : '';
    chips.push(`<button class="chip status-${key}${on}" data-chip="${key}">`
      + `${STATUS_LABEL[key]} (${counts[key]})</button>`);
  }
  if (statusFilter) {
    chips.push(`<button class="chip clear" data-chip="">pokaz wszystkie (${entries.length})</button>`);
  } else if (entries.length && widoczne < entries.length) {
    chips.push(`<span class="chip muted">widocznych ${widoczne}</span>`);
  }
  ui.chips.innerHTML = chips.join('');
}

/**
 * Stany wyjatkowe pokazujemy jako pasek nad tabela, a nie plakietke w naglowku.
 * Plakietka informowala, gdy wszystko dziala, i milczala, gdy przestawalo.
 */
function renderBanners() {
  const out = [];

  if (state && state.catalog) {
    const drift = entries.filter((e) => e.status === 'drifted').length;
    if (drift) {
      out.push(`<div class="banner act"><span>Tibia przywrocila ${drift} `
        + `${plural(drift, 'Twoj dzwiek', 'Twoje dzwieki', 'Twoich dzwiekow')} do wersji oryginalnej.</span>`
        + '<button class="primary" data-b="reapply">Przywroc moje</button>'
        + '<button data-b="dismiss">Nie teraz</button></div>');
    }
  }

  const ff = state && state.ffmpeg;
  if (ff && !(ff.available && ff.libvorbis)) {
    out.push('<div class="banner warn"><span>Nie moge przerabiac plikow dzwiekowych, '
      + 'bo brakuje konwertera ffmpeg. Przegladanie i odsluch dzialaja.</span>'
      + '<button data-b="ffmpegHelp">Jak zainstalowac</button>'
      + '<button data-b="ffmpegRetry">Sprawdz ponownie</button></div>');
  }

  if (state && state.client && state.catalog && state.catalog.enumSource !== 'client.exe') {
    out.push('<div class="banner warn"><span>Nie moglem odczytac nazw akcji z pliku gry, '
      + 'wiec pochodza z zapisanej listy i moga byc nieaktualne.</span></div>');
  }

  const upd = updateBannerHtml();
  if (upd) out.push(upd);

  ui.banners.innerHTML = out.join('');
}

/**
 * Pasek o nowej wersji. Trzy stany, bo to trzy rozne decyzje uzytkownika:
 * jest nowsza, instalator juz lezy na dysku, albo tej instalacji nie da sie
 * zaktualizowac samej (wersja przenosna i rozpakowany zip).
 */
function updateBannerHtml() {
  if (!updateInfo) return '';
  const { release, canInstall, downloaded } = updateInfo;

  if (downloaded) {
    return '<div class="banner act"><span>'
      + `Pobrano wersje ${downloaded.version}${downloaded.verified ? ' i sprawdzono sume kontrolna' : ''}. `
      + 'Instalacja zamknie aplikacje i uruchomi ja ponownie.</span>'
      + '<button class="primary" data-b="updInstall">Zainstaluj teraz</button>'
      + '<button data-b="dismiss">Pozniej</button></div>';
  }

  const naglowek = `Jest wersja ${release.version}, masz ${state && state.appVersion ? state.appVersion : '?'}.`;
  if (!canInstall) {
    return `<div class="banner act"><span>${naglowek} Ta wersja aplikacji nie aktualizuje sie sama, `
      + 'bo instalator wgralby druga kopie obok.</span>'
      + '<button class="primary" data-b="updPage">Otworz strone wydania</button>'
      + '<button data-b="dismiss">Nie teraz</button></div>';
  }
  return `<div class="banner act"><span>${naglowek}</span>`
    + '<button class="primary" data-b="updDownload">Pobierz i zainstaluj</button>'
    + '<button data-b="updPage">Co sie zmienilo</button>'
    + '<button data-b="dismiss">Nie teraz</button></div>';
}

function emptyHtml() {
  if (!state || !state.client) {
    return `<h2>Zacznij od wskazania klienta Tibii</h2>
      <p>Aplikacja odczyta katalog <code>packages/Tibia/sounds</code> i pokaze, ktory plik
      odpowiada za ktory dzwiek w grze: czar, ryk potwora, zapowiedz raidu, muzyke.
      Sama z siebie niczego nie zmienia.</p>
      <button id="emptyPick" class="primary">Wskaz katalog klienta&hellip;</button>`;
  }
  if (!entries.length) {
    return `<h2>Nie znalazlem tu zadnych dzwiekow</h2>
      <p>We wskazanym katalogu nie ma banku dzwiekow klienta. Sprawdz, czy to na pewno
      katalog z Tibia, i wskaz go ponownie.</p>
      <button id="emptyPick">Wskaz inny katalog&hellip;</button>`;
  }
  return `<h2>Nic nie pasuje</h2>
    <p>Zaden z ${entries.length} dzwiekow nie spelnia biezacych warunkow.</p>
    <button id="emptyClear">Wyczysc wyszukiwanie</button>`;
}

ui.empty.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.id === 'emptyPick') {
    guard('Wczytuje klienta', () => api.pickClient());
  } else if (btn.id === 'emptyClear') {
    ui.q.value = '';
    ui.cat.value = '';
    statusFilter = '';
    render();
  }
});

ui.chips.addEventListener('click', (ev) => {
  const chip = ev.target.closest('button[data-chip]');
  if (!chip) return;
  statusFilter = chip.dataset.chip;
  render();
});

ui.banners.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-b]');
  if (!btn) return;
  switch (btn.dataset.b) {
    case 'reapply': await reapplyAll(); break;
    case 'dismiss': btn.closest('.banner').remove(); break;
    case 'ffmpegRetry': await recheckFfmpeg(); break;
    case 'ffmpegHelp':
      say('ffmpeg pobierzesz z ffmpeg.org/download.html - rozpakuj i dodaj katalog bin '
        + 'do zmiennej PATH, potem kliknij "Sprawdz ponownie".');
      break;
    case 'updDownload': await downloadUpdate(); break;
    case 'updInstall': await installUpdate(); break;
    case 'updPage':
      try { await api.updateOpenPage(); } catch (err) { say(humanError(err), 'error'); }
      break;
    default: break;
  }
});

// ---------- aktualizacje ----------

/** Ostatnio znalezione wydanie: { release, canInstall, downloaded }. */
let updateInfo = null;

async function checkUpdate({ cichy = false } = {}) {
  if (!cichy) say('Pytam GitHuba o nowsza wersje…');
  let res;
  try {
    res = await api.updateCheck();
  } catch (err) {
    if (!cichy) say(humanError(err), 'error');
    return;
  }

  if (res.status === 'newer') {
    updateInfo = { release: res.release, canInstall: res.canInstall, downloaded: null };
    renderBanners();
    say(`Jest wersja ${res.release.version}.`);
    return;
  }
  updateInfo = null;
  renderBanners();
  if (cichy) return;
  // "Nie udalo sie zapytac" to co innego niz "masz najnowsza" - pierwsze mowi
  // o sieci, drugie o wersji.
  if (res.status === 'failed') say(`Nie udalo sie sprawdzic: ${res.error}`, 'error');
  else say(`Masz najnowsza wersje (${res.current}).`);
}

async function downloadUpdate() {
  const res = await guard('Pobieram aktualizacje', () => api.updateDownload());
  if (!res || !updateInfo) return;
  updateInfo.downloaded = res;
  renderBanners();
  say(`Pobrano ${res.name} (${Math.round(res.size / 1048576)} MB).`);
}

async function installUpdate() {
  try {
    const res = await api.updateInstall();
    say(`Instaluje wersje ${res.version}. Aplikacja zaraz sie zamknie.`);
  } catch (err) {
    say(humanError(err), 'error');
  }
}

// Automatyczne sprawdzanie (gdy wlaczone) odzywa sie kilka sekund po starcie.
api.onUpdateFound((res) => {
  if (!res || res.status !== 'newer') return;
  updateInfo = { release: res.release, canInstall: res.canInstall, downloaded: null };
  renderBanners();
});

function fillCategories() {
  const counts = new Map();
  for (const e of entries) for (const c of e.categories) counts.set(c, (counts.get(c) || 0) + 1);
  const prev = ui.cat.value;
  ui.cat.innerHTML = `<option value="">wszystkie kategorie (${entries.length})</option>` +
    [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, n]) => `<option value="${c}">${c} (${n})</option>`).join('');
  if ([...counts.keys()].includes(prev)) ui.cat.value = prev;
}

// ---------- odtwarzanie ----------

const PLAY_GLYPH = { play: '&#9654;', playOrig: '&#9654;<sub>o</sub>' };
const STOP_GLYPH = '&#9632;';

function resetPlayButtons() {
  for (const b of document.querySelectorAll('#tb button[data-a="play"], #tb button[data-a="playOrig"]')) {
    b.classList.remove('on');
    b.innerHTML = PLAY_GLYPH[b.dataset.a];
  }
  for (const b of document.querySelectorAll('#webResults button[data-a="webPlay"], #libList button[data-a="libPlay"]')) {
    b.classList.remove('on');
    b.innerHTML = PLAY_GLYPH.play;
  }
}

function markPlaying(soundId, variant) {
  for (const tr of ui.tb.querySelectorAll('tr')) tr.classList.remove('playing');
  resetPlayButtons();
  const row = ui.tb.querySelector(`tr[data-id="${soundId}"]`);
  if (!row) return;
  row.classList.add('playing');
  const btn = row.querySelector(`button[data-a="${variant === 'original' ? 'playOrig' : 'play'}"]`);
  if (btn) {
    btn.classList.add('on');
    btn.innerHTML = STOP_GLYPH;
  }
}

function stopPlayback() {
  audio.pause();
  playing = null;
  webPlaying = null;
  libPlaying = null;
  resetPlayButtons();
  for (const tr of ui.tb.querySelectorAll('tr')) tr.classList.remove('playing');
}

function play(entry, variant) {
  if (playing && playing.soundId === entry.soundId && playing.variant === variant) {
    stopPlayback();
    return;
  }
  stopPlayback();
  const bust = entry.actualHash ? entry.actualHash.slice(0, 12) : Date.now();
  audio.src = `tsound://${variant === 'original' ? 'original' : 'sound'}/${entry.file}?v=${bust}`;
  audio.play().then(() => {
    playing = { soundId: entry.soundId, variant };
    markPlaying(entry.soundId, variant);
  }).catch((err) => say(`Nie moge odtworzyc: ${err.message}`, 'error'));
}

audio.addEventListener('ended', stopPlayback);

// Bez tego nieudane wczytanie zrodla (brak pliku, zerwany podglad) zostawialo
// wiersz zapalony na stale, bo `ended` juz nie przyjdzie.
audio.addEventListener('error', () => {
  if (!playing && webPlaying === null && libPlaying === null) return;
  stopPlayback();
  say('Nie udalo sie wczytac dzwieku do odtworzenia.', 'error');
});

// ---------- stan ----------

function applyState(next) {
  if (!next) return;
  state = next;
  entries = (next.catalog && next.catalog.entries) || [];

  if (next.client) {
    const nazwa = next.client.root.split(/[\\/]/).filter(Boolean).pop() || next.client.root;
    ui.clientLabel.textContent = `Tibia ${next.client.version || '?'} · ${nazwa}`;
    ui.btnClient.title = [
      next.client.root,
      `Wersja klienta: ${next.client.version || 'nieznana'}`,
      `Nazwy akcji: ${next.catalog && next.catalog.enumSource === 'client.exe' ? 'z pliku gry' : 'z zapisanej listy'}`,
      `Wersja aplikacji: ${next.appVersion || '?'}`,
      '',
      'Kliknij, zeby wskazac inna instalacje.',
    ].join('\n');
  } else {
    ui.clientLabel.textContent = 'nie wybrano klienta';
    ui.btnClient.title = 'Kliknij, zeby wskazac katalog klienta Tibii';
  }

  fillCategories();
  renderBanners();
  render();
}

async function recheckFfmpeg() {
  say('Sprawdzam ffmpeg…');
  const ff = await api.detectFfmpeg();
  if (state) state.ffmpeg = ff;
  renderBanners();
  const ok = ff && ff.available && ff.libvorbis;
  say(
    ok ? 'ffmpeg znaleziony - konwersja i wyciszanie dzialaja.' : 'Nadal nie widze ffmpeg z libvorbis.',
    ok ? 'good' : 'error'
  );
}

/** Wskaznik pracy: pasek pod naglowkiem plus kursor. */
function setBusy(on) {
  document.body.classList.toggle('busy', on);
  ui.bar.hidden = !on;
  ui.bar.classList.toggle('indeterminate', on);
  if (on) ui.barFill.style.width = '';
}

async function guard(label, fn) {
  if (busy) {
    say('Poczekaj - poprzednia operacja jeszcze trwa.');
    return null;
  }
  busy = true;
  setBusy(true);
  say(`${label}…`);
  try {
    const result = await fn();
    if (result && result.catalog) applyState(result);
    return result;
  } catch (err) {
    say(humanError(err), 'error');
    return null;
  } finally {
    busy = false;
    setBusy(false);
  }
}

function entryFor(soundId) {
  return entries.find((e) => e.soundId === soundId);
}

function ffmpegReady() {
  if (state.ffmpeg && state.ffmpeg.available && state.ffmpeg.libvorbis) return true;
  say('Do konwersji potrzebny jest ffmpeg - patrz pasek nad lista.', 'error');
  return false;
}

async function doReplace(entry, srcPath) {
  const path = srcPath || (await api.pickAudioFile());
  if (!path) return;
  if (!ffmpegReady()) return;
  stopPlayback();
  flashId = entry.soundId;
  const done = await guard(`Konwertuje ${path.split(/[\\/]/).pop()}`, () =>
    api.replaceSound(entry.soundId, path));
  if (!done) return;

  // Plik ladzie tez w bibliotece, zeby dalo sie go uzyc ponownie bez szukania
  // po dysku. Nieudany import nie moze zepsuc udanej podmiany.
  let wBibliotece = null;
  try {
    wBibliotece = await api.libImport(path);
    if (wBibliotece) await loadLibrary();
  } catch {
    wBibliotece = null;
  }
  say(
    `Podmieniono: ${nameOf(entry)}${wBibliotece ? ' (plik jest tez w Moich dzwiekach)' : ''}`,
    'good'
  );
}

async function reapplyAll() {
  stopPlayback();
  const res = await guard('Wgrywam podmianki z powrotem', async () => {
    const out = await api.reapplyAll();
    return out.state ? { ...out.state, _results: out.results } : null;
  });
  if (res) {
    const ok = (res._results || []).filter((r) => r.ok).length;
    say(`Przywrocono ${ok} ${plural(ok, 'Twoj dzwiek', 'Twoje dzwieki', 'Twoich dzwiekow')}.`, 'good');
  }
}

// ---------- wyszukiwanie w sieci ----------

let replaceTarget = null;
let webResults = [];
let webPlaying = null;
let lastFocus = null;
let generators = [];

async function openReplaceDialog(entry) {
  replaceTarget = entry;
  webResults = [];
  el('webResults').innerHTML = '';
  el('webQuery').value = entry.events[0] || '';
  el('webUrl').value = '';
  el('replaceTarget').textContent = nameOf(entry);
  lastFocus = document.activeElement;
  el('replace').hidden = false;

  const select = el('webProvider');
  if (!select.options.length) {
    const providers = await api.webProviders();
    select.innerHTML = providers
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.builtin ? '' : ' (wlasne)'}</option>`)
      .join('');
    select.dataset.info = JSON.stringify(
      Object.fromEntries(providers.map((p) => [p.id, p.description]))
    );
  }
  showProviderInfo();

  // Generowanie: zapetlenie wlacza sie samo dla dzwiekow, ktore w grze sa petlami.
  el('genResult').innerHTML = '';
  el('genPrompt').value = '';
  el('genLoop').checked = Boolean(entry.isStream);
  if (!generators.length) await loadGenerators();
  else showGeneratorInfo();

  await loadLibrary();
  switchTab('library');
}

// ---------- zakladki zrodel ----------

let activeTab = 'web';

function switchTab(name) {
  activeTab = name;
  for (const b of el('srcTabs').querySelectorAll('button[data-tab]')) {
    b.classList.toggle('on', b.dataset.tab === name);
  }
  for (const p of document.querySelectorAll('.panel[data-panel]')) {
    p.hidden = p.dataset.panel !== name;
  }
  stopPlayback();
}

el('srcTabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tab]');
  if (!btn) return;
  switchTab(btn.dataset.tab);
  if (btn.dataset.tab === 'web') el('webQuery').focus();
  if (btn.dataset.tab === 'generate') el('genPrompt').focus();
});

// ---------- biblioteka wygenerowanych ----------

let libraryItems = [];
let libPlaying = null;
let renamingId = null;

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function loadLibrary() {
  try {
    libraryItems = await api.libList();
  } catch {
    libraryItems = [];
  }
  renderLibrary();
}

function libraryItemHtml(item) {
  const zDysku = item.kind === 'disk';
  const kb = (item.size || 0) / 1024;
  const rozmiar = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} kB`;
  // Skad pochodzi dzwiek, widac od razu - inaczej wlasny plik i wygenerowany
  // wygladalyby identycznie.
  const opis = [
    zDysku ? item.fileName : item.prompt,
    fmtDate(item.createdAt),
    rozmiar,
  ].filter(Boolean).join(' · ');

  return `<div class="res" data-id="${esc(item.id)}">
    <button class="icon" data-a="libPlay" title="Posluchaj / zatrzymaj">&#9654;</button>
    <span class="meta">
      <span class="t"><span class="tag ${zDysku ? 'disk' : 'gen'}">${zDysku ? 'z dysku' : 'AI'}</span>${esc(item.name)}</span>
      <span class="s">${esc(opis)}</span>
    </span>
    <button class="icon" data-a="libRename" title="Zmien nazwe">&#9998;</button>
    <button class="icon" data-a="libRemove" title="Usun z biblioteki">&#128465;</button>
    <button class="act" data-a="libUse">Uzyj</button>
  </div>`;
}

function renderLibrary() {
  el('libCount').textContent = libraryItems.length ? `(${libraryItems.length})` : '';
  el('libList').innerHTML = libraryItems.length
    ? libraryItems.map(libraryItemHtml).join('')
    : '<div class="res"><span class="meta">Nic tu jeszcze nie ma. Wygeneruj dzwiek albo '
      + 'wybierz plik z dysku, a wyladuje tutaj i bedzie mozna go uzyc ponownie.</span></div>';
}

function startRename(row, item) {
  renamingId = item.id;
  const meta = row.querySelector('.t');
  meta.innerHTML = `<input class="rename" value="${esc(item.name)}" maxlength="80">`;
  const input = meta.querySelector('input');
  input.focus();
  input.select();

  const zakoncz = async (zapisz) => {
    if (renamingId !== item.id) return;
    renamingId = null;
    if (zapisz) {
      const nowa = input.value.trim();
      if (nowa && nowa !== item.name) {
        try {
          await api.libRename(item.id, nowa);
          say(`Zmieniono nazwe na "${nowa}".`, 'good');
        } catch (err) {
          say(humanError(err), 'error');
        }
      }
    }
    await loadLibrary();
  };

  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // Escape nalezy do pola, nie do okna
    if (ev.key === 'Enter') zakoncz(true);
    if (ev.key === 'Escape') zakoncz(false);
  });
  input.addEventListener('blur', () => zakoncz(true));
}

el('libList').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-a]');
  if (!btn) return;
  const row = btn.closest('.res');
  const item = libraryItems.find((i) => i.id === row.dataset.id);
  if (!item) return;

  switch (btn.dataset.a) {
    case 'libPlay': {
      if (libPlaying === item.id) { stopPlayback(); return; }
      stopPlayback();
      audio.src = `tsound://library/${item.id}`;
      audio.play().then(() => {
        libPlaying = item.id;
        btn.classList.add('on');
        btn.innerHTML = STOP_GLYPH;
      }).catch((e) => say(`Nie moge odtworzyc: ${e.message}`, 'error'));
      break;
    }

    case 'libRename':
      startRename(row, item);
      break;

    case 'libRemove': {
      stopPlayback();
      try {
        await api.libRemove(item.id);
        await loadLibrary();
        say(`Usunieto "${item.name}" z biblioteki.`);
      } catch (err) {
        say(humanError(err), 'error');
      }
      break;
    }

    case 'libUse': {
      if (!replaceTarget || !ffmpegReady()) return;
      const entry = replaceTarget;
      stopPlayback();
      flashId = entry.soundId;
      const done = await guard(`Wgrywam "${item.name}"`, () => api.libApply(entry.soundId, item.id));
      if (done) {
        say(`Podmieniono ${nameOf(entry)} na "${item.name}".`, 'good');
        closeReplaceDialog();
      }
      break;
    }

    default: break;
  }
});

// ---------- zestawy dzwiekow ----------

let presetItems = [];

async function loadPresets() {
  try {
    presetItems = await api.presetList();
  } catch {
    presetItems = [];
  }
  renderPresets();
}

function presetRowHtml(p) {
  const wlasny = !p.builtin;
  const opis = [p.description, `${p.rules.length} ${plural(p.rules.length, 'regula', 'reguly', 'regul')}`]
    .filter(Boolean).join(' · ');
  return `<div class="res" data-id="${esc(p.id)}">
    <span class="meta">
      <span class="t">${wlasny ? '<span class="tag disk">wlasny</span>' : ''}${esc(p.name)}</span>
      <span class="s">${esc(opis)}</span>
    </span>
    <span class="acts">
      <button class="act" data-a="presetApply">Zastosuj</button>
      ${wlasny ? '<button class="icon" data-a="presetRename" title="Zmien nazwe">&#9998;</button>' : ''}
      ${wlasny ? '<button class="icon" data-a="presetRemove" title="Usun zestaw">&#128465;</button>' : ''}
    </span>
  </div>`;
}

function renderPresets() {
  el('presetList').innerHTML = presetItems.length
    ? presetItems.map(presetRowHtml).join('')
    : '<div class="res"><span class="meta">Brak zestawow.</span></div>';
}

/** Zamiast osobnego okna potwierdzenia pokazujemy liczby w tym samym wierszu. */
async function askPresetConfirm(row, id) {
  const acts = row.querySelector('.acts');
  acts.innerHTML = '<span class="s">licze&hellip;</span>';
  let plan;
  try {
    plan = await api.presetPlan(id);
  } catch (err) {
    say(humanError(err), 'error');
    renderPresets();
    return;
  }

  if (!plan.doZmiany) {
    acts.innerHTML = '<span class="s">nic do zmiany, juz tak jest</span>';
    setTimeout(renderPresets, 2500);
    return;
  }

  const czesci = [];
  if (plan.wycisza) czesci.push(`wyciszy ${plan.wycisza}`);
  if (plan.przywraca) czesci.push(`przywroci ${plan.przywraca}`);
  if (plan.podmienia) czesci.push(`podmieni ${plan.podmienia}`);
  if (plan.bezZmian) czesci.push(`bez zmian ${plan.bezZmian}`);

  acts.innerHTML = `<span class="s">${esc(czesci.join(', '))}</span>`
    + '<button class="act" data-a="presetGo">Potwierdz</button>'
    + '<button class="icon" data-a="presetCancel" title="Anuluj">&#10005;</button>';
}

el('presetList').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-a]');
  if (!btn) return;
  const row = btn.closest('.res');
  const id = row.dataset.id;
  const preset = presetItems.find((p) => p.id === id);
  if (!preset) return;

  switch (btn.dataset.a) {
    case 'presetApply':
      await askPresetConfirm(row, id);
      break;

    case 'presetCancel':
      renderPresets();
      break;

    case 'presetGo': {
      stopPlayback();
      const res = await guard(`Wgrywam zestaw "${preset.name}"`, async () => {
        const out = await api.presetApply(id);
        return out.state ? { ...out.state, _wynik: out } : null;
      });
      if (!res) { renderPresets(); return; }
      const w = res._wynik;
      const problemy = w.problemy.length ? `, pominieto ${w.problemy.length}` : '';
      const przerwane = w.przerwane ? ' (przerwane - gra zostala uruchomiona)' : '';
      say(`Zestaw "${w.name}": zmieniono ${w.zmienione}${problemy}${przerwane}.`,
        w.problemy.length || w.przerwane ? 'error' : 'good');
      el('presets').hidden = true;
      break;
    }

    case 'presetRename': {
      const meta = row.querySelector('.t');
      meta.innerHTML = `<input class="rename" value="${esc(preset.name)}" maxlength="60">`;
      const input = meta.querySelector('input');
      input.focus();
      input.select();
      let gotowe = false;
      const zakoncz = async (zapisz) => {
        if (gotowe) return;
        gotowe = true;
        if (zapisz && input.value.trim()) {
          try {
            await api.presetRename(id, input.value.trim());
          } catch (err) {
            say(humanError(err), 'error');
          }
        }
        await loadPresets();
      };
      input.addEventListener('keydown', (e2) => {
        e2.stopPropagation();
        if (e2.key === 'Enter') zakoncz(true);
        if (e2.key === 'Escape') zakoncz(false);
      });
      input.addEventListener('blur', () => zakoncz(true));
      break;
    }

    case 'presetRemove':
      await api.presetRemove(id);
      await loadPresets();
      say(`Usunieto zestaw "${preset.name}".`);
      break;

    default: break;
  }
});

el('btnPresetSave').addEventListener('click', () => {
  const box = el('presetList');
  box.insertAdjacentHTML('afterbegin',
    '<div class="res"><span class="meta"><input class="rename" id="presetNewName" '
    + 'placeholder="nazwa zestawu, np. Moje ciche popoludnie" maxlength="60"></span>'
    + '<button class="act" id="presetDoSave">Zapisz</button></div>');
  const input = el('presetNewName');
  input.focus();

  const zapisz = async () => {
    const name = input.value.trim();
    if (!name) { say('Podaj nazwe zestawu.', 'error'); return; }
    try {
      const p = await api.presetSaveCurrent(name);
      await loadPresets();
      say(`Zapisano zestaw "${p.name}" (${p.rules.length} regul).`, 'good');
    } catch (err) {
      say(humanError(err), 'error');
    }
  };

  el('presetDoSave').addEventListener('click', zapisz);
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') zapisz();
    if (ev.key === 'Escape') renderPresets();
  });
});

el('btnPresetsClose').addEventListener('click', () => {
  el('presets').hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
});

// ---------- generowanie dzwieku ----------

async function loadGenerators() {
  try {
    generators = await api.genProviders();
  } catch {
    generators = [];
    return;
  }
  el('genProvider').innerHTML = generators
    .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  showGeneratorInfo();
}

function currentGenerator() {
  return generators.find((g) => g.id === el('genProvider').value) || null;
}

function showGeneratorInfo() {
  const g = currentGenerator();
  if (!g) return;

  const sfx = g.kind === 'sfx';
  el('genInfo').textContent = sfx
    ? 'Efekty dzwiekowe z opisu: ryki, uderzenia, zywioly, magia. Nie mowa.'
    : 'Mowa z tekstu: zapowiedzi raidow i komunikaty. Nie odglosy.';

  // Dlugosc i zapetlenie ma tylko generator efektow - przy mowie te pola nic nie znacza.
  for (const node of el('genOpts').querySelectorAll('label')) node.hidden = !sfx;

  el('genKeyRow').hidden = g.hasKey;
  el('btnGenClearKey').hidden = !g.hasKey;
  el('genKeyHint').textContent = g.hasKey
    ? 'Klucz zapisany i zaszyfrowany na tym komputerze. Generowanie obciaza Twoje konto u dostawcy.'
    : `Wymaga Twojego klucza API - aplikacja nie ma wlasnego i za nic nie placi. Klucz utworzysz na: ${g.keyUrl}`;
}

async function runGenerate() {
  const g = currentGenerator();
  if (!g) return;
  if (!g.hasKey) { say('Najpierw zapisz klucz API tego generatora.', 'error'); return; }

  const prompt = el('genPrompt').value.trim();
  if (!prompt) { say('Opisz, jaki dzwiek wygenerowac.', 'error'); return; }

  const opts = {};
  if (g.kind === 'sfx') {
    const d = Number(el('genDur').value);
    if (Number.isFinite(d) && d > 0) opts.durationSec = d;
    opts.loop = el('genLoop').checked;
  }

  stopPlayback();
  const box = el('genResult');
  box.innerHTML = '<div class="res"><span class="meta">Generuje&hellip; to moze potrwac kilkanascie sekund.</span></div>';

  try {
    const item = await api.genGenerate(g.id, prompt, opts);
    box.innerHTML = '';
    await loadLibrary();
    // Wygenerowany dzwiek trafia do biblioteki i tam nim zarzadzasz - nie ma sensu
    // pokazywac go drugi raz w innym miejscu.
    switchTab('library');
    say(`Gotowe: "${item.name}" trafilo do Moich dzwiekow.`, 'good');
  } catch (err) {
    box.innerHTML = `<div class="res"><span class="meta">Blad: ${esc(humanError(err))}</span></div>`;
  }
}

el('btnGenerate').addEventListener('click', runGenerate);
el('genPrompt').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') runGenerate(); });
el('genProvider').addEventListener('change', showGeneratorInfo);

el('btnGenSaveKey').addEventListener('click', async () => {
  const g = currentGenerator();
  const value = el('genKey').value.trim();
  if (!g || !value) return;
  try {
    await api.genSetKey(g.id, value);
    el('genKey').value = '';
    generators = await api.genProviders();
    showGeneratorInfo();
    say('Klucz zapisany i zaszyfrowany.', 'good');
  } catch (err) {
    say(humanError(err), 'error');
  }
});

el('btnGenClearKey').addEventListener('click', async () => {
  const g = currentGenerator();
  if (!g) return;
  await api.genClearKey(g.id);
  generators = await api.genProviders();
  showGeneratorInfo();
  say('Klucz usuniety.');
});


function showProviderInfo() {
  const select = el('webProvider');
  const info = JSON.parse(select.dataset.info || '{}');
  el('webProviderInfo').textContent = info[select.value] || '';
}

function closeReplaceDialog() {
  el('replace').hidden = true;
  replaceTarget = null;
  stopPlayback();
  // Fokus wraca tam, skad przyszedl - inaczej po zamknieciu ladowal na <body>.
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

function resultHtml(r, index) {
  const dur = r.durationSec ? fmtDur(r.durationSec) : '';
  return `<div class="res" data-i="${index}">
    <button class="icon" data-a="webPlay" title="Posluchaj / zatrzymaj">&#9654;</button>
    <span class="meta">
      <span class="t">${esc(r.title)}</span>
      <span class="s">${esc(r.author || '')}</span>
    </span>
    <span class="dur">${dur}</span>
    <button class="act" data-a="webUse">Uzyj</button>
  </div>`;
}

async function runWebSearch() {
  const query = el('webQuery').value.trim();
  if (!query) return;
  const providerId = el('webProvider').value;
  const box = el('webResults');
  stopPlayback();
  box.innerHTML = '<div class="res"><span class="meta">Szukam&hellip;</span></div>';

  try {
    const found = await api.webSearch(providerId, query, 20);
    webResults = found.results || [];
    box.innerHTML = webResults.length
      ? webResults.map(resultHtml).join('')
      : '<div class="res"><span class="meta">Brak wynikow dla tej frazy.</span></div>';
  } catch (err) {
    webResults = [];
    box.innerHTML = `<div class="res"><span class="meta">Blad: ${esc(humanError(err))}</span></div>`;
  }
}

el('webResults').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-a]');
  if (!btn) return;
  const index = Number(btn.closest('.res').dataset.i);
  const result = webResults[index];
  if (!result) return;

  if (btn.dataset.a === 'webPlay') {
    if (webPlaying === index) { stopPlayback(); return; } // drugi klik zatrzymuje
    stopPlayback();
    audio.src = `tsound://preview/${result.previewKey}`;
    audio.play().then(() => {
      webPlaying = index;
      btn.classList.add('on');
      btn.innerHTML = STOP_GLYPH;
    }).catch((e) => say(`Nie moge odtworzyc podgladu: ${e.message}`, 'error'));
    return;
  }

  if (btn.dataset.a === 'webUse') {
    if (!ffmpegReady() || !replaceTarget) return;
    const entry = replaceTarget;
    stopPlayback();
    flashId = entry.soundId;
    const done = await guard(`Pobieram "${result.title}"`, () => api.webApply(entry.soundId, result));
    if (done) {
      say(`Podmieniono ${nameOf(entry)} na "${result.title}"`, 'good');
      closeReplaceDialog();
    }
  }
});

el('btnWebSearch').addEventListener('click', runWebSearch);
el('webQuery').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') runWebSearch(); });
el('webProvider').addEventListener('change', showProviderInfo);
el('btnReplaceClose').addEventListener('click', closeReplaceDialog);

el('btnFromDisk').addEventListener('click', async () => {
  const entry = replaceTarget;
  closeReplaceDialog();
  if (entry) await doReplace(entry);
});

// Wyciszenie to wariant podmiany (applySound z mode:'mute'), wiec siedzi w tym samym
// oknie zamiast zajmowac ikone w kazdym z 844 wierszy.
el('btnSilence').addEventListener('click', async () => {
  const entry = replaceTarget;
  closeReplaceDialog();
  if (entry) await muteEntry(entry);
});

el('btnWebUrl').addEventListener('click', async () => {
  const url = el('webUrl').value.trim();
  if (!url || !replaceTarget || !ffmpegReady()) return;
  const entry = replaceTarget;
  stopPlayback();
  flashId = entry.soundId;
  const done = await guard('Pobieram plik z podanego linku', () => api.webApplyUrl(entry.soundId, url));
  if (done) {
    say(`Podmieniono ${nameOf(entry)} z linku`, 'good');
    closeReplaceDialog();
  }
});

// ---------- operacje na wierszu ----------

async function muteEntry(entry) {
  if (!ffmpegReady()) return;
  stopPlayback();
  flashId = entry.soundId;
  const ok = await guard(`Wyciszam ${nameOf(entry)}`, () => api.muteSound(entry.soundId));
  if (ok) say(`Wyciszono: ${nameOf(entry)}`, 'good');
}

async function resetEntry(entry) {
  stopPlayback();
  flashId = entry.soundId;
  const ok = await guard(`Przywracam ${nameOf(entry)}`, () => api.resetSound(entry.soundId));
  if (ok) say(`Przywrocono oryginal: ${nameOf(entry)}`, 'good');
}

async function runRowAction(action, entry) {
  switch (action) {
    case 'play': play(entry, 'current'); break;
    case 'playOrig': play(entry, 'original'); break;
    case 'replace': await openReplaceDialog(entry); break;
    case 'reveal': api.revealSound(entry.soundId); break;
    case 'mute': await muteEntry(entry); break;
    case 'reset': await resetEntry(entry); break;
    case 'copyId':
      try {
        await navigator.clipboard.writeText(String(entry.soundId));
        say(`Skopiowano id ${entry.soundId}.`);
      } catch {
        say(`Id tego dzwieku: ${entry.soundId}`);
      }
      break;
    default: break;
  }
}

ui.tb.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-a]');
  if (!btn) return;
  const entry = entryFor(Number(btn.closest('tr').dataset.id));
  if (entry) await runRowAction(btn.dataset.a, entry);
});

// ---------- menu pod prawym przyciskiem ----------

let rowMenuTarget = null;

function closeMenus() {
  ui.menu.hidden = true;
  ui.rowMenu.hidden = true;
  ui.btnMenu.setAttribute('aria-expanded', 'false');
  rowMenuTarget = null;
}

function openMenuAt(menu, x, y) {
  menu.hidden = false;
  // Ustawiamy po pokazaniu, bo dopiero wtedy znamy rozmiar menu.
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.min(x, window.innerWidth - w - 6)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - h - 6)}px`;
}

ui.tb.addEventListener('contextmenu', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (!tr) return;
  ev.preventDefault();
  const entry = entryFor(Number(tr.dataset.id));
  if (!entry) return;

  rowMenuTarget = entry;
  // Pozycje bez sensu w danym stanie po prostu znikaja - tak jak przyciski w wierszu.
  const ma = entry.status === 'replaced' || entry.status === 'drifted';
  ui.rowMenu.querySelector('[data-r="playOrig"]').hidden = !ma;
  ui.rowMenu.querySelector('[data-r="reset"]').hidden = entry.status === 'original';
  ui.rowMenu.querySelector('[data-r="mute"]').hidden = entry.status === 'missing';
  openMenuAt(ui.rowMenu, ev.clientX, ev.clientY);
});

ui.rowMenu.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-r]');
  if (!btn) return;
  const entry = rowMenuTarget;
  closeMenus();
  if (entry) await runRowAction(btn.dataset.r, entry);
});

// ---------- menu glowne ----------

ui.btnMenu.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (!ui.menu.hidden) { closeMenus(); return; }
  const r = ui.btnMenu.getBoundingClientRect();
  ui.menu.querySelector('[data-m="tech"]').textContent = showTech
    ? 'Ukryj szczegoly techniczne'
    : 'Pokaz szczegoly techniczne';
  markTheme();
  markAuto();
  ui.menu.hidden = false;
  openMenuAt(ui.menu, r.right - ui.menu.offsetWidth, r.bottom + 4);
  ui.btnMenu.setAttribute('aria-expanded', 'true');
});

/** Podswietlenie aktualnie wybranego wygladu w przelaczniku. */
function markTheme() {
  const biezacy = (state && state.theme) || 'system';
  for (const b of ui.menu.querySelectorAll('.seg button[data-m^="theme:"]')) {
    b.classList.toggle('on', b.dataset.m === `theme:${biezacy}`);
  }
}

/** Podswietlenie stanu automatycznego sprawdzania aktualizacji. */
function markAuto() {
  const wlaczone = Boolean(state && state.update && state.update.auto);
  for (const b of ui.menu.querySelectorAll('.seg button[data-m^="auto:"]')) {
    b.classList.toggle('on', b.dataset.m === (wlaczone ? 'auto:on' : 'auto:off'));
  }
}

const THEME_LABEL = { system: 'jak w systemie', light: 'jasny', dark: 'ciemny' };

ui.menu.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-m]');
  if (!btn) return;

  // Wyglad przelacza sie od razu i BEZ zamykania menu - efekt widac natychmiast,
  // wiec mozna porownac warianty jednym klikni&#281;ciem.
  if (btn.dataset.m.startsWith('theme:')) {
    const source = btn.dataset.m.slice(6);
    try {
      const res = await api.setTheme(source);
      if (state) state.theme = res.theme;
      markTheme();
      say(`Wyglad: ${THEME_LABEL[source] || source}.`);
    } catch (err) {
      say(humanError(err), 'error');
    }
    return;
  }

  // Przelacznik automatycznego sprawdzania tez zostawia menu otwarte, zeby bylo
  // widac, ze wybor sie zapisal.
  if (btn.dataset.m.startsWith('auto:')) {
    const enabled = btn.dataset.m === 'auto:on';
    try {
      const res = await api.updateSetAuto(enabled);
      if (state && state.update) state.update.auto = res;
      markAuto();
      say(enabled
        ? 'Aplikacja sprawdzi wersje raz na dobe, przy starcie.'
        : 'Aplikacja nie bedzie pytac o wersje sama.');
    } catch (err) {
      say(humanError(err), 'error');
    }
    return;
  }

  closeMenus();

  switch (btn.dataset.m) {
    case 'refresh': await refreshNow(); break;
    case 'update': await checkUpdate(); break;

    case 'export': {
      const res = await guard('Zapisuje kopie podmianek', () => api.exportProfile());
      if (!res) return;
      const mb = (res.bytes / 1048576).toFixed(1);
      const pominiete = res.skipped.length ? `, pominieto ${res.skipped.length}` : '';
      say(`Zapisano ${res.liczba} podmianek (${mb} MB)${pominiete}: ${res.path}`, 'good');
      break;
    }

    case 'import': {
      stopPlayback();
      const res = await guard('Wczytuje kopie podmianek', async () => {
        const out = await api.importProfile();
        return out && out.state ? { ...out.state, _wynik: out } : null;
      });
      if (!res) return;
      const { applied, skipped } = res._wynik;
      if (skipped.length) {
        const powody = [...new Set(skipped.map((s) => s.powod))].join('; ');
        say(`Przywrocono ${applied.length}, pominieto ${skipped.length} (${powody})`,
          applied.length ? 'good' : 'error');
      } else {
        say(`Przywrocono ${applied.length} `
          + `${plural(applied.length, 'podmianke', 'podmianki', 'podmianek')}.`, 'good');
      }
      break;
    }

    case 'tech':
      showTech = !showTech;
      saveColumnSettings();
      buildHead();
      applyWidths();
      render();
      say(showTech ? 'Pokazuje kolumny techniczne.' : 'Ukrylem kolumny techniczne.');
      break;

    case 'cols':
      autoColumns = true;
      widths = defaultWidths();
      saveColumnSettings();
      fitColumns();
      say('Szerokosci kolumn zresetowane.');
      break;

    case 'presets': {
      lastFocus = document.activeElement;
      await loadPresets();
      el('presets').hidden = false;
      break;
    }

    case 'vault': api.openVault(); break;

    case 'about': {
      el('aboutBody').textContent = state && state.appVersion
        ? `Wersja ${state.appVersion}. Podglad i podmiana dzwiekow klienta Tibii.`
        : 'Podglad i podmiana dzwiekow klienta Tibii.';
      lastFocus = document.activeElement;
      ui.about.hidden = false;
      break;
    }

    default: break;
  }
});

el('btnAboutClose').addEventListener('click', () => {
  ui.about.hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
});

document.addEventListener('click', (ev) => {
  if (ui.menu.hidden && ui.rowMenu.hidden) return;
  if (ev.target.closest('#menu, #rowMenu, #btnMenu')) return;
  closeMenus();
});

window.addEventListener('blur', closeMenus);

// ---------- drag & drop ----------

ui.tb.addEventListener('dragover', (ev) => {
  const tr = ev.target.closest('tr');
  if (!tr) return;
  ev.preventDefault();
  for (const r of ui.tb.querySelectorAll('tr.dragover')) r.classList.remove('dragover');
  tr.classList.add('dragover');
});

ui.tb.addEventListener('dragleave', (ev) => {
  const tr = ev.target.closest('tr');
  if (tr) tr.classList.remove('dragover');
});

ui.tb.addEventListener('drop', async (ev) => {
  const tr = ev.target.closest('tr');
  if (!tr) return;
  ev.preventDefault();
  tr.classList.remove('dragover');
  const file = ev.dataTransfer.files[0];
  if (!file) return;
  const srcPath = api.pathForFile(file);
  if (!srcPath) {
    say('Nie udalo sie odczytac sciezki upuszczonego pliku.', 'error');
    return;
  }
  const entry = entryFor(Number(tr.dataset.id));
  if (entry) await doReplace(entry, srcPath);
});

document.addEventListener('dragover', (ev) => ev.preventDefault());
document.addEventListener('drop', (ev) => ev.preventDefault());

// ---------- szerokosci kolumn ----------

/**
 * Tabela ma `table-layout: fixed`, wiec szerokosciami steruje <colgroup>.
 * Uchwyt na prawej krawedzi naglowka zmienia szerokosc, dwuklik dopasowuje
 * kolumne do najdluzszej tresci. Ustawienia zostaja w localStorage.
 */

const COLUMN_STORAGE_KEY = 'columns.v3';
const MIN_COLUMN_WIDTH = 44;

function defaultWidths() {
  return Object.fromEntries(COLUMNS.map((c) => [c.key, c.min]));
}

let widths = defaultWidths();
let autoColumns = true;
let cols = [];
let headers = [];

function loadColumnSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || '{}');
    if (typeof saved.auto === 'boolean') autoColumns = saved.auto;
    if (typeof saved.tech === 'boolean') showTech = saved.tech;
    for (const [key, value] of Object.entries(saved.widths || {})) {
      if (COLUMNS.some((c) => c.key === key) && Number.isFinite(value)) {
        widths[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(value));
      }
    }
  } catch {
    // uszkodzony wpis - lecimy na ustawieniach domyslnych
  }
}

function saveColumnSettings() {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY,
      JSON.stringify({ auto: autoColumns, tech: showTech, widths }));
  } catch {
    // brak miejsca albo tryb prywatny - ustawienia nie przetrwaja restartu
  }
}

/** Bez jawnej szerokosci tabeli przegladarka rozciaga kolumny pod tresc. */
function syncTableWidth() {
  const total = activeColumns().reduce((sum, c) => sum + widths[c.key], 0);
  ui.grid.style.width = `${total}px`;
}

function applyWidths() {
  cols = [...ui.cg.querySelectorAll('col')];
  for (const col of cols) col.style.width = `${widths[col.dataset.col]}px`;
  syncTableWidth();
}

function setWidth(key, px) {
  widths[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(px));
  const col = cols.find((c) => c.dataset.col === key);
  if (col) col.style.width = `${widths[key]}px`;
  syncTableWidth();
}

/** Czcionki komorek czytamy raz z wyrenderowanego wiersza i trzymamy w cache. */
function columnFonts(key, index) {
  if (!columnFonts.cache) columnFonts.cache = {};
  if (columnFonts.cache[key]) return columnFonts.cache[key];

  const row = ui.tb.rows[0];
  if (!row || !row.cells[index]) return null;

  const cell = row.cells[index];
  const cellStyle = getComputedStyle(cell);
  const src = cell.querySelector('.src');
  const headStyle = getComputedStyle(headers[index]);

  const value = {
    cell: `${cellStyle.fontWeight} ${cellStyle.fontSize} ${cellStyle.fontFamily}`,
    sub: src
      ? (() => {
        const s = getComputedStyle(src);
        return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      })()
      : null,
    header: `${headStyle.fontWeight} ${headStyle.fontSize} ${headStyle.fontFamily}`,
    padding: parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight),
  };
  columnFonts.cache[key] = value;
  return value;
}

/**
 * Najszersza tresc w kolumnie. Mierzymy z modelu danych, nie z DOM - `innerText`
 * na 844 wierszach wymusza przeliczenie ukladu przy kazdym dopasowaniu.
 */
function contentWidth(index, rows = visible()) {
  const col = activeColumns()[index];
  if (col.rigid) return col.min;

  const fonts = columnFonts(col.key, index);
  if (!fonts) return widths[col.key];

  const canvas = contentWidth.canvas || (contentWidth.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');

  ctx.font = fonts.header;
  let max = ctx.measureText(headers[index].querySelector('.label').textContent).width;

  for (const entry of rows) {
    const lines = col.lines(entry);
    for (let i = 0; i < lines.length; i += 1) {
      ctx.font = i > 0 && fonts.sub ? fonts.sub : fonts.cell;
      const w = ctx.measureText(lines[i]).width;
      if (w > max) max = w;
    }
  }
  // zapas na strzalke sortowania i uchwyt, plus kropka statusu w kolumnie nazwy
  return Math.ceil(max + fonts.padding + 18 + (col.extra || 0));
}

/**
 * 1. kazda kolumna dostaje tyle, ile potrzebuje jej tresc, w granicach min/max
 * 2. gdy zostaje miejsce - nadmiar idzie do kolumny `flex`
 * 3. gdy brakuje - zabieramy proporcjonalnie do zapasu ponad `min`, pomijajac `rigid`
 */
function fitColumns() {
  const available = document.querySelector('main').clientWidth - 1;
  if (available <= 0) return;

  const active = activeColumns();
  const rows = visible();
  const next = active.map((c, i) => (c.rigid
    ? c.min
    : Math.min(Math.max(contentWidth(i, rows), c.min), c.max)));

  const total = next.reduce((a, b) => a + b, 0);
  const flexIndex = active.findIndex((c) => c.flex);

  if (total < available && flexIndex >= 0) {
    next[flexIndex] += available - total;
  } else if (total > available) {
    let excess = total - available;
    for (let pass = 0; pass < 2 && excess > 0.5; pass += 1) {
      const headroom = next.map((w, i) => (active[i].rigid ? 0 : w - active[i].min));
      const room = headroom.reduce((a, b) => a + b, 0);
      if (room <= 0.5) break;
      const take = Math.min(excess, room);
      for (let i = 0; i < next.length; i += 1) {
        if (headroom[i] <= 0) continue;
        next[i] -= (headroom[i] / room) * take;
      }
      excess -= take;
    }
  }

  active.forEach((c, i) => { widths[c.key] = Math.max(c.min, Math.round(next[i])); });
  applyWidths();
}

function startResize(event, index) {
  event.preventDefault();
  event.stopPropagation();
  const key = activeColumns()[index].key;
  const startX = event.clientX;
  const startWidth = widths[key];
  const handle = event.currentTarget;

  handle.classList.add('dragging');
  document.body.classList.add('resizing');

  const onMove = (moveEvent) => setWidth(key, startWidth + (moveEvent.clientX - startX));
  const onUp = () => {
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // reczna zmiana wylacza dopasowanie automatyczne, inaczej najblizszy render by ja cofnal
    autoColumns = false;
    saveColumnSettings();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/** Naglowki powstaja od nowa przy kazdym przelaczeniu kolumn - listenery tez. */
function wireHeaders() {
  headers = [...ui.hr.querySelectorAll('th')];

  headers.forEach((th, index) => {
    if (th.dataset.k) {
      th.addEventListener('click', (ev) => {
        if (ev.target.closest('.resizer')) return; // klik w uchwyt nie sortuje
        const k = th.dataset.k;
        sortDesc = sortKey === k ? !sortDesc : false;
        sortKey = k;
        buildHead();
        applyWidths();
        render();
      });
    }

    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    resizer.title = 'Przeciagnij aby zmienic szerokosc, dwuklik aby dopasowac do tresci';
    resizer.addEventListener('mousedown', (ev) => startResize(ev, index));
    resizer.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setWidth(activeColumns()[index].key, contentWidth(index));
      saveColumnSettings();
    });
    resizer.addEventListener('click', (ev) => ev.stopPropagation());
    th.appendChild(resizer);
  });
}

// Zmiana rozmiaru okna - z odroczeniem, zeby nie liczyc szerokosci przy kazdym pikselu.
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!autoColumns) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitColumns, 120);
});

// ---------- filtry, glosnosc, odswiezanie ----------

// Kazda litera przebudowuje liste 844 wierszy i przelicza szerokosci kolumn -
// bez odroczenia pisanie zacina sie na wolniejszej maszynie.
let filterTimer = null;
ui.q.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(render, 90);
});

ui.cat.addEventListener('input', render);

const VOLUME_KEY = 'volume';

ui.vol.addEventListener('input', () => {
  audio.volume = Number(ui.vol.value);
  try {
    localStorage.setItem(VOLUME_KEY, ui.vol.value);
  } catch {
    // bez zapisu glosnosc wroci do domyslnej po restarcie - nie blokuje pracy
  }
});

function loadVolume() {
  const saved = Number(localStorage.getItem(VOLUME_KEY));
  const v = Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.7;
  ui.vol.value = String(v);
  audio.volume = v;
}

async function refreshNow() {
  const res = await guard('Przeliczam statusy', () => api.refresh());
  if (res) say(`Przeliczono ${entries.length} ${SOUNDS(entries.length)}.`, 'good');
}

/**
 * Launcher Tibii nadpisuje pliki przy patchu, wiec statusy w otwartym oknie
 * potrafia sie zdezaktualizowac bez naszego udzialu. Zamiast przycisku "Odswiez"
 * przeliczamy je po powrocie do okna - nie czesciej niz raz na 5 sekund.
 */
let lastAutoRefresh = 0;
window.addEventListener('focus', async () => {
  if (!state || !state.client || busy) return;
  const now = Date.now();
  if (now - lastAutoRefresh < 5000) return;
  lastAutoRefresh = now;
  const res = await api.refresh();
  applyState(res);
});

document.addEventListener('keydown', (ev) => {
  const overlay = openOverlay();

  if (ev.key === 'Escape') {
    if (!ui.menu.hidden || !ui.rowMenu.hidden) { closeMenus(); return; }
    // Ostrzezenie startowe wymaga swiadomego potwierdzenia, wiec Escape go nie zamyka.
    if (overlay === el('replace')) closeReplaceDialog();
    else if (overlay === el('presets')) el('btnPresetsClose').click();
    else if (overlay === ui.about) el('btnAboutClose').click();
    else if (!overlay && (playing || webPlaying !== null)) stopPlayback();
    return;
  }

  if (ev.key === 'F5') {
    ev.preventDefault();
    if (!overlay) refreshNow();
    return;
  }

  if (ev.key === 'Tab' && overlay) {
    // Liste liczymy przy kazdym Tabie: wyniki wyszukiwania dokladaja po dwa
    // przyciski na pozycje i zmieniaja sie po kazdym szukaniu.
    const items = [...overlay.querySelectorAll('button, input, select, textarea')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];
    if (!overlay.contains(document.activeElement)) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
    return;
  }

  // "/" skacze do wyszukiwarki, o ile nie piszemy juz w jakims polu
  if (ev.key === '/' && !overlay && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    ev.preventDefault();
    ui.q.focus();
    ui.q.select();
  }
});

/** Widoczny modal, jesli jakikolwiek jest otwarty. */
function openOverlay() {
  if (!ui.warning.hidden) return ui.warning;
  if (!el('replace').hidden) return el('replace');
  if (!el('presets').hidden) return el('presets');
  if (!ui.about.hidden) return ui.about;
  return null;
}

// Klik w tlo zamyka okno - odruch, ktorego probuje kazdy uzytkownik Windows.
// mousedown, a nie click, zeby zaznaczanie tekstu zakonczone poza modalem nie zamykalo go.
el('replace').addEventListener('mousedown', (ev) => {
  if (ev.target === el('replace')) closeReplaceDialog();
});

ui.btnClient.addEventListener('click', () => guard('Wczytuje klienta', () => api.pickClient()));

el('btnWarnClose').addEventListener('click', async () => {
  ui.warning.hidden = true;
  await api.acceptWarning();
});

api.onProgress(({ done, total, label }) => {
  if (done < total) {
    // Liczenie odciskow i wgrywanie zestawu to jedyne operacje, ktore znaja swoj
    // postep - pokazujemy go wprost.
    ui.bar.hidden = false;
    ui.bar.classList.remove('indeterminate');
    ui.barFill.style.width = `${Math.round((done / total) * 100)}%`;
    say(`${label || 'Sprawdzam dzwieki'}: ${done} / ${total}`);
    return;
  }
  if (busy) {
    ui.bar.classList.add('indeterminate');
    ui.barFill.style.width = '';
  } else {
    ui.bar.hidden = true;
  }
  say('');
});

/**
 * Punkt zaczepienia dla skryptow deweloperskich w tools/. Istnieje po to, zeby testy
 * nie musialy klikac po id ani czytac komorek po indeksie - jedno i drugie rozsypywalo
 * sie przy kazdej zmianie ukladu.
 */
window.__tsc = {
  refresh: refreshNow,
  render,
  fit: fitColumns,
  columns: COLUMNS,
  // Pasek aktualizacji da sie zobaczyc tylko wtedy, gdy naprawde wyszlo nowsze
  // wydanie. Zeby dalo sie go sprawdzic bez czekania na kolejne, e2e podstawia
  // tu wynik sprawdzenia i wola renderBanners().
  setUpdate: (info) => {
    updateInfo = info;
    renderBanners();
  },
  setTech: (on) => {
    showTech = on;
    buildHead();
    applyWidths();
    render();
  },
  get auto() { return autoColumns; },
  setAuto: (on) => {
    autoColumns = on;
    saveColumnSettings();
    if (on) fitColumns();
  },
  get widths() { return widths; },
  get entries() { return entries; },
  get state() { return state; },
};

// ---------- start ----------

(async () => {
  say('Startuje…');
  loadColumnSettings();
  loadVolume();
  buildHead();
  applyWidths();

  const init = await api.init();
  applyState(init);
  if (!init.warningAccepted) ui.warning.hidden = false;
  if (!init.client) say('Wskaz katalog klienta Tibii, zeby zaczac.');
  else say(`Wczytano ${entries.length} ${SOUNDS(entries.length)}.`, 'good');
})();
