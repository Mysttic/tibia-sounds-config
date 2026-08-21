'use strict';

const { downloadToTemp } = require('./net');

/**
 * Generowanie dzwiekow z opisu tekstowego.
 *
 * Warstwa adapterow zbudowana tak samo jak zrodla wyszukiwania w providers.js,
 * z jedna roznica: kazdy adapter wymaga klucza API uzytkownika. Aplikacja nie ma
 * wlasnego klucza i za nic nie placi - koszt i regulamin sa po stronie osoby,
 * ktora klucz wkleila.
 *
 * Co adapter dostaje: prompt i opcje. Co oddaje: plik audio w katalogu tymczasowym
 * plus opis pochodzenia. Dalej idzie ta sama sciezka co plik z dysku - kopia
 * oryginalu, konwersja ffmpegiem do formatu gry, zapis atomowy.
 *
 * UWAGA licencyjna: to, co wolno zrobic z wygenerowanym dzwiekiem, zalezy od planu
 * u dostawcy. Darmowy plan ElevenLabs nie daje licencji komercyjnej i wymaga
 * atrybucji. Aplikacja zapisuje pochodzenie w profilu, ale nie zna planu uzytkownika,
 * wiec nie moze tego za niego rozstrzygnac.
 */

const MAX_PROMPT = 500;

function cleanPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('napisz, jaki dzwiek wygenerowac');
  return text.slice(0, MAX_PROMPT);
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// --- ElevenLabs: efekty dzwiekowe --------------------------------------------

/**
 * POST /v1/sound-generation zwraca gotowy plik mp3, nie JSON.
 * `loop` ma tu realne zastosowanie: 220 z 844 dzwiekow klienta to petle ambience,
 * ktore po podmianie na material bez zapetlenia slychac jako "klikniecie" na styku.
 */
const elevenlabs = {
  id: 'elevenlabs',
  name: 'ElevenLabs (efekty dzwiekowe)',
  kind: 'sfx',
  builtin: true,
  needsKey: true,
  keyHeader: 'xi-api-key',
  keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  homepage: 'https://elevenlabs.io/sound-effects',
  description: 'Efekt dzwiekowy z opisu, do 30 s, z opcja zapetlenia. Wymaga Twojego klucza API.',

  async generate(prompt, {
    durationSec = null, loop = false, influence = 0.3, key, download = downloadToTemp,
  } = {}) {
    if (!key) throw new Error('brak klucza API dla ElevenLabs');

    const body = {
      text: cleanPrompt(prompt),
      model_id: 'eleven_text_to_sound_v2',
      prompt_influence: clamp(influence, 0, 1, 0.3),
      loop: Boolean(loop),
    };
    // Pominiete pole = dostawca sam dobiera dlugosc; to lepsze niz zgadywanie.
    if (durationSec) body.duration_seconds = clamp(durationSec, 0.5, 30, 3);

    const dl = await download('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });

    return {
      path: dl.path,
      dir: dl.dir,
      size: dl.size,
      contentType: dl.contentType,
      title: body.text.slice(0, 80),
      origin: {
        providerId: 'elevenlabs',
        title: body.text.slice(0, 80),
        author: 'ElevenLabs',
        license: 'wg planu u dostawcy',
        licenseUrl: 'https://elevenlabs.io/terms',
        pageUrl: 'https://elevenlabs.io/sound-effects',
        attribution: `wygenerowane: "${body.text.slice(0, 120)}"`,
      },
    };
  },
};

// --- OpenRouter: mowa ---------------------------------------------------------

/**
 * OpenRouter nie generuje efektow dzwiekowych - ma wylacznie mowe. W katalogu Tibii
 * jest to jednak przydatne dla komunikatow: zapowiedzi raidow to zdania, nie odglosy.
 * Model podajemy jako parametr, bo lista dostepnych glosow i modeli u posrednika
 * zmienia sie czesciej niz nasze wydania.
 */
const openrouterTts = {
  id: 'openrouter-tts',
  name: 'OpenRouter (mowa)',
  kind: 'tts',
  builtin: true,
  needsKey: true,
  keyHeader: 'Authorization',
  keyUrl: 'https://openrouter.ai/keys',
  homepage: 'https://openrouter.ai/docs/guides/overview/multimodal/tts',
  description: 'Zamienia tekst w mowe - do zapowiedzi raidow i komunikatow, nie do odglosow.',
  defaults: { model: 'openai/gpt-4o-mini-tts', voice: 'alloy' },

  async generate(prompt, {
    model = 'openai/gpt-4o-mini-tts', voice = 'alloy', key, download = downloadToTemp,
  } = {}) {
    if (!key) throw new Error('brak klucza API dla OpenRouter');

    const text = cleanPrompt(prompt);
    const dl = await download('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        model: String(model),
        input: text,
        voice: String(voice),
        response_format: 'mp3',
      }),
      timeoutMs: 120_000,
    });

    return {
      path: dl.path,
      dir: dl.dir,
      size: dl.size,
      contentType: dl.contentType,
      title: text.slice(0, 80),
      origin: {
        providerId: 'openrouter-tts',
        title: text.slice(0, 80),
        author: `OpenRouter / ${model}`,
        license: 'wg regulaminu dostawcy modelu',
        licenseUrl: 'https://openrouter.ai/terms',
        pageUrl: 'https://openrouter.ai/',
        attribution: `wygenerowana mowa: "${text.slice(0, 120)}"`,
      },
    };
  },
};

// --- rejestr -----------------------------------------------------------------

const GENERATORS = [elevenlabs, openrouterTts];

/** Opis dla interfejsu - bez niczego, co mogloby zdradzic klucz. */
function listGenerators() {
  return GENERATORS.map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    description: g.description,
    homepage: g.homepage,
    keyUrl: g.keyUrl,
    needsKey: g.needsKey,
    defaults: g.defaults || null,
  }));
}

function getGenerator(id) {
  const found = GENERATORS.find((g) => g.id === id);
  if (!found) throw new Error(`nieznany generator: ${id}`);
  return found;
}

module.exports = {
  listGenerators,
  getGenerator,
  cleanPrompt,
  clamp,
  GENERATORS,
  elevenlabs,
  openrouterTts,
  MAX_PROMPT,
};
