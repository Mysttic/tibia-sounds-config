/* eslint-disable */
/**
 * Sprawdza spakowana aplikacje (dist/win-unpacked): czy dziala zapis, vault w userData
 * i powrot do oryginalu. Uruchamiac przez:
 *   CDP_PORT=9223 node tools/cdp-probe.js --file tools/e2e-packaged.js
 */
(async () => {
  // Wygeneruj wczesniej: ffmpeg -f lavfi -i "sine=frequency=900:duration=1.5" -b:a 192k C:\Temp\tibia-sounds-test\testowy.mp3
  const MP3 = 'C:/Temp/tibia-sounds-test/testowy.mp3';
  const RAID = 677;
  const log = [];

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tsc.setTech(true); // pelny zestaw kolumn do odczytu

  const refresh = async () => { await window.__tsc.refresh(); await wait(250); };
  const row = () => document.querySelector(`#tb tr[data-id="${RAID}"]`);
  const cell = (col) => {
    const td = row().querySelector(`td[data-col="${col}"]`);
    return td ? td.textContent.trim() : '(brak kolumny)';
  };
  const state = () => `${row().dataset.status} | ${cell('size')} | ${cell('durationSec')}`;

  log.push(`[0] przed:        ${state()}`);
  await api.replaceSound(RAID, MP3);
  await refresh();
  log.push(`[1] po podmianie: ${state()}`);
  log.push(`[1] zrodlo w wierszu: ${cell('event').includes('testowy.mp3')}`);

  await api.resetSound(RAID);
  await refresh();
  log.push(`[2] po resecie:   ${state()}`);
  log.push(`[3] chipy statusow: "${document.getElementById('chips').textContent.trim()}"`);
  return log.join('\n');
})()
