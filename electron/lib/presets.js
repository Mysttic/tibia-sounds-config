'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Zestawy dzwiekow ("presety").
 *
 * Preset nie jest lista plikow, tylko uporzadkowana lista regul. Kluczowa zasada:
 * OSTATNIA pasujaca regula wygrywa. Bez tego nie da sie zwiezle zapisac
 * "wycisz wszystko oprocz broni" - trzeba by wyliczyc kilkaset identyfikatorow.
 *
 *   1. { all: true }                    -> cisza
 *   2. { categories: ['WEAPON_ATTACK'] } -> oryginal
 *
 * Dzwieki, ktorych nie dotyka zadna regula, zostaja bez zmian. Dzieki temu
 * "bez muzyki" wycisza muzyke i NIE rusza pozostalych podmianek uzytkownika.
 *
 * Preset wazy kilkaset bajtow i nie zawiera audio. Jest wiec alternatywa dla
 * eksportu profilu tylko w obrebie jednej biblioteki - do przeniesienia wlasnych
 * plikow na inny komputer nadal potrzebny jest eksport, ktory wozi dzwieki.
 */

const FORMAT = 'tibia-sounds-config/presets';
const VERSION = 1;
const MAX_NAME = 60;
const MAX_RULES = 200;
const ID_PATTERN = /^[0-9a-f]{12}$/;

const ACTIONS = ['mute', 'original'];

// --- walidacja ---------------------------------------------------------------

function cleanName(value, fallback = 'zestaw bez nazwy') {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  return (text || fallback).slice(0, MAX_NAME);
}

/** Akcja to 'mute', 'original' albo { libraryId }. Zwraca znormalizowana albo rzuca. */
function normalizeAction(action) {
  if (typeof action === 'string') {
    if (!ACTIONS.includes(action)) throw new Error(`nieznana akcja: ${action}`);
    return action;
  }
  if (action && typeof action.libraryId === 'string' && action.libraryId) {
    return { libraryId: action.libraryId };
  }
  throw new Error('regula musi miec akcje: "mute", "original" albo { libraryId }');
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('regula musi byc obiektem');
  const match = rule.match || {};
  const out = { match: {}, action: normalizeAction(rule.action) };

  if (match.all) out.match.all = true;
  if (Array.isArray(match.categories) && match.categories.length) {
    out.match.categories = match.categories.map((c) => String(c));
  }
  if (Array.isArray(match.soundIds) && match.soundIds.length) {
    out.match.soundIds = match.soundIds.map((n) => Number(n)).filter(Number.isFinite);
  }
  if (!out.match.all && !out.match.categories && !out.match.soundIds) {
    throw new Error('regula musi wskazywac "all", "categories" albo "soundIds"');
  }
  return out;
}

function normalizePreset(raw) {
  const rules = Array.isArray(raw && raw.rules) ? raw.rules : [];
  if (!rules.length) throw new Error('zestaw musi miec co najmniej jedna regule');
  if (rules.length > MAX_RULES) throw new Error(`za duzo regul (limit ${MAX_RULES})`);
  return {
    id: ID_PATTERN.test(String(raw.id || '')) ? raw.id : crypto.randomBytes(6).toString('hex'),
    name: cleanName(raw.name),
    description: String(raw.description || '').slice(0, 200),
    builtin: false,
    rules: rules.map(normalizeRule),
  };
}

// --- rozstrzyganie regul -----------------------------------------------------

function ruleMatches(rule, entry) {
  const m = rule.match;
  if (m.all) return true;
  if (m.soundIds && m.soundIds.includes(entry.soundId)) return true;
  if (m.categories && entry.categories.some((c) => m.categories.includes(c))) return true;
  return false;
}

/**
 * Dla kazdego dzwieku wylicza docelowa akcje. Zwraca Map<soundId, akcja>,
 * bez wpisow dla dzwiekow, ktorych zaden warunek nie dotyczy.
 */
function resolvePreset(preset, entries) {
  const plan = new Map();
  for (const entry of entries) {
    let action = null;
    // Bez `break` - ostatnia pasujaca regula ma wygrac.
    for (const rule of preset.rules) {
      if (ruleMatches(rule, entry)) action = rule.action;
    }
    if (action) plan.set(entry.soundId, action);
  }
  return plan;
}

/**
 * Co realnie trzeba zrobic: pomija dzwieki, ktore juz sa w docelowym stanie.
 * Zwraca { doZrobienia: [{soundId, action}], bezZmian, problemy: [{soundId, powod}] }
 */
function planChanges(plan, entries) {
  const byId = new Map(entries.map((e) => [e.soundId, e]));
  const doZrobienia = [];
  const problemy = [];
  let bezZmian = 0;

  for (const [soundId, action] of plan) {
    const entry = byId.get(soundId);
    if (!entry) continue;

    if (entry.status === 'missing') {
      problemy.push({ soundId, powod: 'brak pliku w kliencie' });
      continue;
    }

    const wpis = entry.profile;
    const juzTak = action === 'original'
      ? entry.status === 'original'
      : action === 'mute'
        ? Boolean(wpis && wpis.mode === 'mute' && entry.status === 'replaced')
        : Boolean(wpis && wpis.origin && wpis.origin.libraryId === action.libraryId
          && entry.status === 'replaced');

    if (juzTak) bezZmian += 1;
    else doZrobienia.push({ soundId, action, file: entry.file });
  }
  return { doZrobienia, bezZmian, problemy };
}

// --- presety wbudowane -------------------------------------------------------

/**
 * Liczby w opisach pochodza z realnego banku klienta 15.32 (844 dzwieki) i sluza
 * tylko za wskazowke - w innej wersji klienta moga sie roznic.
 */
const BUILTIN = [
  {
    id: 'builtin-original',
    name: 'Wszystko oryginalne',
    description: 'Przywraca kazdy dzwiek do stanu fabrycznego.',
    builtin: true,
    rules: [{ match: { all: true }, action: 'original' }],
  },
  {
    id: 'builtin-no-music',
    name: 'Bez muzyki',
    description: 'Wycisza muzyke, reszty nie rusza (~25 dzwiekow).',
    builtin: true,
    rules: [{ match: { categories: ['MUSIC'] }, action: 'mute' }],
  },
  {
    id: 'builtin-no-ambience',
    name: 'Bez odglosow otoczenia',
    description: 'Wycisza petle tla i odglosy obiektow (~203 dzwieki).',
    builtin: true,
    rules: [{ match: { categories: ['AMBIENCE_STREAM', 'AMBIENCE_OBJECT'] }, action: 'mute' }],
  },
  {
    id: 'builtin-combat-only',
    name: 'Cicho, tylko walka',
    description: 'Cisza wszedzie poza atakami bronia i czarami ofensywnymi.',
    builtin: true,
    rules: [
      { match: { all: true }, action: 'mute' },
      { match: { categories: ['WEAPON_ATTACK', 'SPELL_ATTACK'] }, action: 'original' },
    ],
  },
  {
    id: 'builtin-alerts-only',
    name: 'Tylko powiadomienia',
    description: 'Cisza wszedzie poza rajdami, czatem i komunikatami serwera.',
    builtin: true,
    rules: [
      { match: { all: true }, action: 'mute' },
      {
        match: {
          categories: [
            'RAID_ANNOUNCEMENT', 'SERVER_MESSAGE', 'CHAT_MESSAGE',
            'WHISPER_WITHOUT_OPEN_CHAT', 'VIP_LIST', 'PARTY',
          ],
        },
        action: 'original',
      },
    ],
  },
];

// --- zestawy uzytkownika -----------------------------------------------------

class PresetStore {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  async load() {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      this.data = Array.isArray(raw.items) ? raw : { format: FORMAT, version: VERSION, items: [] };
    } catch {
      this.data = { format: FORMAT, version: VERSION, items: [] };
    }
    return this.data;
  }

  async save() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fsp.rename(tmp, this.file);
  }

  /** Wbudowane najpierw, potem wlasne. */
  async list() {
    const data = await this.load();
    return [...BUILTIN, ...data.items];
  }

  async get(id) {
    const found = (await this.list()).find((p) => p.id === id);
    if (!found) throw new Error(`nie ma takiego zestawu: ${id}`);
    return found;
  }

  async add(raw) {
    const data = await this.load();
    const preset = normalizePreset(raw);
    data.items.unshift(preset);
    await this.save();
    return preset;
  }

  async rename(id, name) {
    const data = await this.load();
    const item = data.items.find((p) => p.id === id);
    if (!item) throw new Error('wbudowanych zestawow nie da sie zmieniac');
    item.name = cleanName(name, item.name);
    await this.save();
    return item.name;
  }

  async remove(id) {
    const data = await this.load();
    const at = data.items.findIndex((p) => p.id === id);
    if (at < 0) return false;
    data.items.splice(at, 1);
    await this.save();
    return true;
  }
}

/**
 * Zamienia biezacy stan katalogu w zestaw regul - "zapisz to, co mam teraz".
 * Wyliczamy regule na kazdy zmieniony dzwiek plus jedna zbiorcza na oryginaly,
 * zeby zestaw odtwarzal uklad w calosci, a nie tylko dokladal zmiany.
 */
function presetFromState(name, entries) {
  const rules = [{ match: { all: true }, action: 'original' }];

  const mute = [];
  const zBiblioteki = new Map(); // libraryId -> [soundId]

  for (const e of entries) {
    const wpis = e.profile;
    if (!wpis || e.status === 'missing') continue;
    if (wpis.mode === 'mute') {
      mute.push(e.soundId);
    } else if (wpis.origin && wpis.origin.libraryId) {
      const lista = zBiblioteki.get(wpis.origin.libraryId) || [];
      lista.push(e.soundId);
      zBiblioteki.set(wpis.origin.libraryId, lista);
    }
    // Podmianki z pliku spoza biblioteki pomijamy - nie mamy do czego sie odwolac.
  }

  if (mute.length) rules.push({ match: { soundIds: mute }, action: 'mute' });
  for (const [libraryId, soundIds] of zBiblioteki) {
    rules.push({ match: { soundIds }, action: { libraryId } });
  }

  return normalizePreset({ name, rules, description: 'Zapisany biezacy uklad dzwiekow.' });
}

module.exports = {
  FORMAT,
  VERSION,
  MAX_NAME,
  MAX_RULES,
  ACTIONS,
  BUILTIN,
  PresetStore,
  cleanName,
  normalizeAction,
  normalizeRule,
  normalizePreset,
  ruleMatches,
  resolvePreset,
  planChanges,
  presetFromState,
};
