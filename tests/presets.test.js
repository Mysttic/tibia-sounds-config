'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  BUILTIN, PresetStore, normalizePreset, normalizeRule, resolvePreset, planChanges,
  presetFromState, cleanName, MAX_RULES,
} = require('../electron/lib/presets');

/** Uproszczony katalog: tyle, ile potrzebuja reguly. */
function wpis(soundId, categories, extra = {}) {
  return {
    soundId,
    file: `sound-${String(soundId).padStart(64, '0')}.ogg`,
    categories,
    status: 'original',
    profile: null,
    ...extra,
  };
}

const KATALOG = [
  wpis(1, ['WEAPON_ATTACK']),
  wpis(2, ['MUSIC']),
  wpis(3, ['AMBIENCE_STREAM']),
  wpis(4, ['CREATURE_NOISE']),
  wpis(677, ['RAID_ANNOUNCEMENT']),
];

// --- walidacja ---------------------------------------------------------------

test('regula musi wskazywac cokolwiek i miec znana akcje', () => {
  assert.throws(() => normalizeRule({ action: 'mute' }), /all.*categories.*soundIds/);
  assert.throws(() => normalizeRule({ match: { all: true }, action: 'skasuj' }), /nieznana akcja/);
  assert.throws(() => normalizeRule({ match: { all: true } }), /musi miec akcje/);

  const ok = normalizeRule({ match: { all: true }, action: 'mute' });
  assert.deepEqual(ok, { match: { all: true }, action: 'mute' });

  const zBiblioteki = normalizeRule({ match: { soundIds: [1] }, action: { libraryId: 'abc' } });
  assert.deepEqual(zBiblioteki.action, { libraryId: 'abc' });
});

test('zestaw bez regul i z nadmiarem regul jest odrzucany', () => {
  assert.throws(() => normalizePreset({ name: 'x', rules: [] }), /co najmniej jedna/);
  const duzo = Array.from({ length: MAX_RULES + 1 }, () => ({ match: { all: true }, action: 'mute' }));
  assert.throws(() => normalizePreset({ name: 'x', rules: duzo }), /za duzo regul/);
});

test('nazwa jest czyszczona i przycinana', () => {
  assert.equal(cleanName('  Moj zestaw \n'), 'Moj zestaw');
  assert.equal(cleanName(''), 'zestaw bez nazwy');
  assert.equal(cleanName('x'.repeat(200)).length, 60);
});

// --- rozstrzyganie regul -----------------------------------------------------

test('ostatnia pasujaca regula wygrywa - inaczej "wszystko oprocz" nie dziala', () => {
  const preset = normalizePreset({
    name: 'tylko bronie',
    rules: [
      { match: { all: true }, action: 'mute' },
      { match: { categories: ['WEAPON_ATTACK'] }, action: 'original' },
    ],
  });
  const plan = resolvePreset(preset, KATALOG);

  assert.equal(plan.get(1), 'original', 'bron zostaje oryginalna');
  assert.equal(plan.get(2), 'mute');
  assert.equal(plan.get(4), 'mute');
  assert.equal(plan.size, KATALOG.length, 'regula "all" dotyczy wszystkich');
});

test('dzwieki bez pasujacej reguly zostaja nietkniete', () => {
  const preset = normalizePreset({
    name: 'bez muzyki',
    rules: [{ match: { categories: ['MUSIC'] }, action: 'mute' }],
  });
  const plan = resolvePreset(preset, KATALOG);
  assert.equal(plan.size, 1);
  assert.equal(plan.get(2), 'mute');
  assert.equal(plan.has(1), false, 'nie rusza pozostalych podmianek uzytkownika');
});

test('regula moze celowac w pojedynczy dzwiek', () => {
  const preset = normalizePreset({
    name: 'tylko rajd',
    rules: [
      { match: { all: true }, action: 'mute' },
      { match: { soundIds: [677] }, action: 'original' },
    ],
  });
  const plan = resolvePreset(preset, KATALOG);
  assert.equal(plan.get(677), 'original');
  assert.equal(plan.get(1), 'mute');
});

// --- co realnie trzeba zrobic ------------------------------------------------

test('planChanges pomija dzwieki, ktore juz sa w docelowym stanie', () => {
  const katalog = [
    wpis(1, ['MUSIC'], { status: 'replaced', profile: { mode: 'mute' } }), // juz wyciszony
    wpis(2, ['MUSIC']),                                                    // do wyciszenia
    wpis(3, ['WEAPON_ATTACK']),                                            // juz oryginalny
  ];
  const preset = normalizePreset({
    name: 'x',
    rules: [
      { match: { categories: ['MUSIC'] }, action: 'mute' },
      { match: { categories: ['WEAPON_ATTACK'] }, action: 'original' },
    ],
  });
  const { doZrobienia, bezZmian, problemy } = planChanges(resolvePreset(preset, katalog), katalog);

  assert.equal(bezZmian, 2, 'wyciszony i oryginalny nie wymagaja pracy');
  assert.deepEqual(doZrobienia.map((c) => c.soundId), [2]);
  assert.deepEqual(problemy, []);
});

test('brakujacy plik trafia do problemow, nie do roboty', () => {
  const katalog = [wpis(1, ['MUSIC'], { status: 'missing' })];
  const preset = normalizePreset({ name: 'x', rules: [{ match: { all: true }, action: 'mute' }] });
  const { doZrobienia, problemy } = planChanges(resolvePreset(preset, katalog), katalog);

  assert.deepEqual(doZrobienia, []);
  assert.equal(problemy.length, 1);
  assert.match(problemy[0].powod, /brak pliku/);
});

test('dzwiek juz wgrany z tego samego wpisu biblioteki nie jest ruszany', () => {
  const katalog = [
    wpis(1, ['UI'], { status: 'replaced', profile: { mode: 'replace', origin: { libraryId: 'aaa' } } }),
    wpis(2, ['UI'], { status: 'replaced', profile: { mode: 'replace', origin: { libraryId: 'bbb' } } }),
  ];
  const preset = normalizePreset({
    name: 'x',
    rules: [{ match: { categories: ['UI'] }, action: { libraryId: 'aaa' } }],
  });
  const { doZrobienia, bezZmian } = planChanges(resolvePreset(preset, katalog), katalog);

  assert.equal(bezZmian, 1);
  assert.deepEqual(doZrobienia.map((c) => c.soundId), [2], 'tylko ten z innym dzwiekiem');
});

// --- presety wbudowane -------------------------------------------------------

test('wbudowane zestawy sa poprawne i robia to, co obiecuja', () => {
  for (const p of BUILTIN) {
    assert.ok(p.id && p.name && p.rules.length, `zestaw ${p.id} jest niekompletny`);
    assert.equal(p.builtin, true);
    for (const r of p.rules) normalizeRule(r); // rzuci, jesli cos nie tak
  }

  const walka = BUILTIN.find((p) => p.id === 'builtin-combat-only');
  const plan = resolvePreset(walka, KATALOG);
  assert.equal(plan.get(1), 'original', 'bron slyszalna');
  assert.equal(plan.get(2), 'mute', 'muzyka cicho');
  assert.equal(plan.get(4), 'mute', 'potwory cicho');

  const bezMuzyki = BUILTIN.find((p) => p.id === 'builtin-no-music');
  assert.equal(resolvePreset(bezMuzyki, KATALOG).size, 1, 'rusza tylko muzyke');
});

// --- zapis biezacego ukladu --------------------------------------------------

test('zapis biezacego ukladu odtwarza wyciszenia i dzwieki z biblioteki', () => {
  const katalog = [
    wpis(1, ['MUSIC'], { status: 'replaced', profile: { mode: 'mute' } }),
    wpis(2, ['MUSIC'], { status: 'replaced', profile: { mode: 'mute' } }),
    wpis(3, ['UI'], { status: 'replaced', profile: { mode: 'replace', origin: { libraryId: 'abc' } } }),
    wpis(4, ['UI']),
    // podmianka z pliku spoza biblioteki - nie ma do czego sie odwolac
    wpis(5, ['UI'], { status: 'replaced', profile: { mode: 'replace', origin: null } }),
  ];
  const preset = presetFromState('Moj uklad', katalog);
  const plan = resolvePreset(preset, katalog);

  assert.equal(plan.get(1), 'mute');
  assert.equal(plan.get(2), 'mute');
  assert.deepEqual(plan.get(3), { libraryId: 'abc' });
  assert.equal(plan.get(4), 'original', 'nietkniete wracaja do oryginalu');
  assert.equal(plan.get(5), 'original', 'podmianki bez biblioteki nie da sie odtworzyc');
});

// --- zestawy uzytkownika -----------------------------------------------------

test('wlasne zestawy zapisuja sie, zmieniaja nazwe i usuwaja', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-pre-'));
  try {
    const store = new PresetStore(path.join(dir, 'presets.json'));
    const lista0 = await store.list();
    assert.equal(lista0.length, BUILTIN.length, 'na starcie sa same wbudowane');

    const p = await store.add({ name: 'Moj cichy', rules: [{ match: { all: true }, action: 'mute' }] });
    assert.equal((await store.list()).length, BUILTIN.length + 1);
    assert.equal((await store.get(p.id)).name, 'Moj cichy');

    assert.equal(await store.rename(p.id, 'Zupelna cisza'), 'Zupelna cisza');
    assert.equal(await store.remove(p.id), true);
    assert.equal(await store.remove(p.id), false);
    await assert.rejects(() => store.get(p.id), /nie ma takiego zestawu/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('wbudowanych zestawow nie da sie zmienic ani usunac', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-pre-'));
  try {
    const store = new PresetStore(path.join(dir, 'presets.json'));
    await assert.rejects(() => store.rename('builtin-no-music', 'inna'), /wbudowanych/);
    assert.equal(await store.remove('builtin-no-music'), false);
    assert.equal((await store.get('builtin-no-music')).name, 'Bez muzyki');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('uszkodzony plik zestawow nie wywala aplikacji', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tsc-pre-'));
  try {
    const file = path.join(dir, 'presets.json');
    await fsp.writeFile(file, '{ to nie jest json');
    const store = new PresetStore(file);
    assert.equal((await store.list()).length, BUILTIN.length);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
