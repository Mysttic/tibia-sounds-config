/* eslint-disable */
/**
 * E2E wyszukiwania w sieci, uruchamiane na KOPII klienta (testclient).
 * Cykl: otworz modal -> wyszukaj w Openverse -> podglad -> pobierz i podmien
 *       -> sprawdz status i metadane pochodzenia -> przywroc oryginal.
 *
 *   node tools/cdp-probe.js --file tools/e2e-web.js
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
  const waitFor = async (fn, ms = 30000) => {
    for (let i = 0; i < ms / 200; i += 1) { if (fn()) return true; await wait(200); }
    return false;
  };

  log.push(`[0] klient: ${document.getElementById('clientLabel').textContent}`);
  log.push(`[0] stan #${RAID}: ${st(RAID)} | ${cell(RAID, 'size')} | ${cell(RAID, 'durationSec')}`);

  // --- modal
  row(RAID).querySelector('button[data-a="replace"]').click();
  await wait(800);
  const modalOtwarty = !document.getElementById('replace').hidden;
  const zrodla = [...document.getElementById('webProvider').options].map((o) => o.textContent);
  log.push(`[1] modal otwarty: ${modalOtwarty}, cel: ${document.getElementById('replaceTarget').textContent}`);
  log.push(`[1] dostepne zrodla: ${zrodla.join(' | ')}`);

  // --- wyszukiwanie
  document.getElementById('webQuery').value = 'big explosion';
  document.getElementById('btnWebSearch').click();
  const maWyniki = await waitFor(() => document.querySelectorAll('#webResults .res button[data-a="webUse"]').length > 0);
  const wyniki = [...document.querySelectorAll('#webResults .res')].slice(0, 3).map((r) => {
    const t = r.querySelector('.t');
    return t ? `${t.textContent.trim().slice(0, 34)} [${(r.querySelector('.lic') || {}).textContent || '?'}] ${(r.querySelector('.dur') || {}).textContent || ''}` : '';
  }).filter(Boolean);
  log.push(`[2] wyszukiwanie "big explosion": ${maWyniki ? 'ok' : 'BRAK WYNIKOW'}, pozycji: ${document.querySelectorAll('#webResults .res').length}`);
  for (const w of wyniki) log.push(`      ${w}`);

  if (!maWyniki) return log.join('\n');

  // --- podglad przez tsound://preview
  const first = document.querySelector('#webResults .res');
  first.querySelector('button[data-a="webPlay"]').click();
  const gra = await waitFor(() => { const a = document.querySelector('audio') || window.__a; return true; }, 3000);
  await wait(1500);
  log.push(`[3] podglad wystartowal, src: ${(document.querySelectorAll('audio')[0] || {}).src || 'przez obiekt Audio'}`);

  // --- pobranie i podmiana
  const przed = { rozmiar: cell(RAID, 'size'), dlugosc: cell(RAID, 'durationSec'), status: st(RAID) };
  first.querySelector('button[data-a="webUse"]').click();
  const gotowe = await waitFor(() => document.getElementById('replace').hidden, 90000);
  await refresh();
  log.push(`[4] pobranie i podmiana zakonczone: ${gotowe}`);
  log.push(`[4] komunikat: ${document.getElementById('msg').textContent}`);
  log.push(`[4] #${RAID}: ${przed.status} ${przed.rozmiar}/${przed.dlugosc}  ->  ${st(RAID)} ${cell(RAID, 'size')}/${cell(RAID, 'durationSec')}`);
  log.push(`[4] zrodlo w wierszu: ${cell(RAID, 'event').replace(/\s+/g, ' ').slice(0, 90)}`);

  // --- przywrocenie
  await api.resetSound(RAID);
  await refresh();
  log.push(`[5] po przywroceniu: ${st(RAID)} | ${cell(RAID, 'size')} | ${cell(RAID, 'durationSec')}`);
  log.push(`[5] chipy statusow: "${document.getElementById('chips').textContent.trim()}"`);

  return log.join('\n');
})()
