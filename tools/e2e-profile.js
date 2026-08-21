/* eslint-disable */
/**
 * E2E podmiany z sieci na KOPII klienta (testclient): pobranie wyniku z Openverse,
 * zapis do klienta i zachowanie odtwarzacza w liscie wynikow.
 *
 * Uwaga: eksportu i importu profilu ten skrypt NIE sprawdza - okna zapisu i odczytu
 * pliku sa systemowe, wiec CDP ich nie obsluzy. Ta sciezke pokrywaja testy jednostkowe
 * `tests/portable.test.js` (buildBundle/applyBundle) plus reczny przebieg opisany
 * w docs/TESTING.md.
 *
 *   node tools/cdp-probe.js --file tools/e2e-profile.js
 */
(async () => {
  const RAID = 677;
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tsc.setTech(true); // pelny zestaw kolumn do odczytu
  const row = (id) => document.querySelector(`#tb tr[data-id="${id}"]`);
  const st = (id) => row(id).dataset.status;
  const cell = (id, col) => {
    const td = row(id) && row(id).querySelector(`td[data-col="${col}"]`);
    return td ? td.textContent.trim() : '(brak kolumny)';
  };
  const refresh = async () => { await window.__tsc.refresh(); await wait(250); };
  const waitFor = async (fn, ms = 60000) => {
    for (let i = 0; i < ms / 200; i += 1) { if (fn()) return true; await wait(200); }
    return false;
  };

  // --- 1. podmiana z sieci
  const r = await api.webSearch('openverse', 'big explosion', 5);
  await api.webApply(RAID, r.results[0]);
  await refresh();
  log.push(`[1] po podmianie: ${st(RAID)} | ${cell(RAID, 'size')} | ${cell(RAID, 'durationSec')} | "${r.results[0].title}"`);

  // --- 2. przelacznik odtwarzania w wynikach
  document.querySelector(`#tb tr[data-id="${RAID}"] button[data-a="replace"]`).click();
  await wait(700);
  document.getElementById('webQuery').value = 'explosion';
  document.getElementById('btnWebSearch').click();
  await waitFor(() => document.querySelectorAll('#webResults .res button[data-a="webPlay"]').length > 0);
  const play = document.querySelector('#webResults .res button[data-a="webPlay"]');
  play.click();
  await wait(1200);
  const gra = play.classList.contains('on');
  play.click();
  await wait(400);
  const stoi = !play.classList.contains('on');
  log.push(`[2] przelacznik odtwarzania: start=${gra}, drugi klik zatrzymuje=${stoi}`);
  log.push(`[2] licencja usunieta z listy: ${document.querySelectorAll('#webResults .lic').length === 0}`);
  document.getElementById('btnReplaceClose').click();
  await wait(300);

  return log.join('\n');
})()
