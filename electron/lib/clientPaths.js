'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

/**
 * Lokalizowanie i walidacja instalacji klienta Tibii.
 *
 * Uklad ktorego szukamy:
 *   <root>/packages/Tibia/sounds/catalog-sound.json
 *   <root>/packages/Tibia/bin/client.exe        (opcjonalne, do nazw akcji)
 *   <root>/packages/Tibia/package.json          (opcjonalne, wersja klienta)
 */

const REL_SOUNDS = path.join('packages', 'Tibia', 'sounds');
const REL_BIN = path.join('packages', 'Tibia', 'bin');
const CLIENT_EXE = process.platform === 'win32' ? 'client.exe' : 'client';

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Typowe miejsca instalacji launchera Tibii. */
function candidateRoots() {
  const home = os.homedir();
  const list = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    list.push(path.join(local, 'Tibia'));
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (pf) list.push(path.join(pf, 'Tibia'));
    }
  } else if (process.platform === 'darwin') {
    list.push(path.join(home, 'Applications', 'Tibia'));
    list.push('/Applications/Tibia');
  } else {
    list.push(path.join(home, '.local', 'share', 'Tibia'));
    list.push(path.join(home, 'Tibia'));
  }
  return list;
}

/**
 * Sprawdza czy `dir` to poprawny katalog klienta.
 * Jest wyrozumialy: przyjmuje tez wskazanie packages/Tibia albo samego sounds/.
 * Zwraca { ok, root, soundsDir, clientExe, version, reason }.
 */
async function validateClientDir(dir) {
  if (!dir) return { ok: false, reason: 'nie podano sciezki' };
  const tries = [
    dir,
    path.resolve(dir, '..', '..'),      // wskazano packages/Tibia/sounds
    path.resolve(dir, '..', '..', '..'), // wskazano cos glebiej
  ];
  for (const root of tries) {
    const soundsDir = path.join(root, REL_SOUNDS);
    if (!(await exists(path.join(soundsDir, 'catalog-sound.json')))) continue;
    const clientExe = path.join(root, REL_BIN, CLIENT_EXE);
    let version = null;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'packages', 'Tibia', 'package.json'), 'utf8'));
      version = pkg.version || null;
    } catch {
      // brak manifestu - nie blokuje
    }
    return {
      ok: true,
      root,
      soundsDir,
      clientExe: (await exists(clientExe)) ? clientExe : null,
      version,
    };
  }
  return { ok: false, reason: `nie znaleziono ${REL_SOUNDS}${path.sep}catalog-sound.json w ${dir}` };
}

/** Pierwszy dzialajacy kandydat albo null. */
async function autodetect() {
  for (const root of candidateRoots()) {
    const res = await validateClientDir(root);
    if (res.ok) return res;
  }
  return null;
}

module.exports = { validateClientDir, autodetect, candidateRoots, REL_SOUNDS, REL_BIN, CLIENT_EXE };
