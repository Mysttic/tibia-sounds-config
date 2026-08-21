/* eslint-disable */
/**
 * Wyrazenie wykonywane w rendererze przez `node tools/cdp-probe.js --file`.
 * Pelny cykl na kopii klienta: odtwarzanie -> podmiana -> A/B -> wyciszenie -> reset.
 * Krok "drift" jest osobno (tools/e2e-drift.js), bo wymaga ruchu na plikach z zewnatrz.
 *
 * Komorki czytamy po `data-col`, a nie po indeksie - kolumny techniczne mozna
 * wlaczac i wylaczac, wiec indeksy nie sa stabilne.
 */
(async () => {
  // Wygeneruj wczesniej: ffmpeg -f lavfi -i "sine=frequency=900:duration=1.5" -b:a 192k C:\Temp\tibia-sounds-test\testowy.mp3
  const MP3 = 'C:\\Temp\\tibia-sounds-test\\testowy.mp3';
  const RAID = 677;    // raid_announcement #2776
  const UI = 675;      // UI #2774
  const FOREIGN = 905; // recznie podmieniony wczesniej, obok lezy ___kopia
  const log = [];

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tsc.setTech(true); // pelny zestaw kolumn do odczytu

  const row = (id) => document.querySelector(`#tb tr[data-id="${id}"]`);
  const st = (id) => (row(id) ? row(id).dataset.status : 'brak-wiersza');
  const cell = (id, col) => {
    const td = row(id) && row(id).querySelector(`td[data-col="${col}"]`);
    return td ? td.textContent.trim() : '(brak kolumny)';
  };
  const refresh = async () => { await window.__tsc.refresh(); await wait(250); };
  const chips = () => document.getElementById('chips').textContent.trim();
  const load = (url) => new Promise((res) => {
    const a = new Audio(url);
    a.onloadedmetadata = () => res(`ok ${a.duration.toFixed(2)}s`);
    a.onerror = () => res(`blad ${a.error && a.error.code}`);
    setTimeout(() => res('timeout'), 5000);
  });

  const raidFile = window.__tsc.entries.find((e) => e.soundId === RAID).file;

  log.push(`[0] stan poczatkowy: raid=${st(RAID)} ui=${st(UI)} foreign#${FOREIGN}=${st(FOREIGN)}`);
  log.push(`[0] akcja raida w tabeli: "${cell(RAID, 'event')}"`);
  log.push(`[1] odtwarzanie tsound://sound -> ${await load(`tsound://sound/${raidFile}`)}`);

  await api.replaceSound(RAID, MP3);
  await refresh();
  log.push(`[2] po podmianie raid: ${st(RAID)} | ${cell(RAID, 'size')} | ${cell(RAID, 'durationSec')}`);
  log.push(`[2] wiersz pokazuje zrodlo mp3: ${cell(RAID, 'event').includes('testowy.mp3')}`);
  log.push(`[2] kropka statusu w nazwie: ${Boolean(row(RAID).querySelector('.dot.status-replaced'))}`);
  log.push(`[3] A/B oryginal -> ${await load(`tsound://original/${raidFile}`)}`);
  log.push(`[3] A/B podmianka -> ${await load(`tsound://sound/${raidFile}?v=${performance.now()}`)}`);

  const uiBefore = cell(UI, 'size');
  await api.muteSound(UI);
  await refresh();
  log.push(`[4] po wyciszeniu UI: ${st(UI)} | ${uiBefore} -> ${cell(UI, 'size')} | ${cell(UI, 'durationSec')}`);

  log.push(`[5] foreign przed resetem: ${st(FOREIGN)}`);
  let foreignMsg = 'ok';
  try {
    await api.resetSound(FOREIGN);
  } catch (e) {
    foreignMsg = e.message;
  }
  await refresh();
  log.push(`[5] foreign po resecie z kopii ___: ${st(FOREIGN)} (${foreignMsg})`);

  log.push(`[6] chipy statusow: ${chips()}`);
  return log.join('\n');
})()
