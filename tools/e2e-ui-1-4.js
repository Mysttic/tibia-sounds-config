/* eslint-disable */
/**
 * E2E przebudowanego interfejsu 1.4.0, na KOPII klienta (testclient).
 * Sprawdza to, co zostalo po odchudzeniu: kropke statusu zamiast kolumny,
 * warunkowe przyciski w wierszu, chipy-filtry, pasy warunkowe, menu, kolumny
 * techniczne, skroty i to, ze tabela miesci sie w oknie.
 *
 *   node tools/cdp-probe.js --file tools/e2e-ui-1-4.js
 */
(async () => {
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = (id) => document.querySelector(`#tb tr[data-id="${id}"]`);
  const RAID = 677;

  const waitFor = async (fn, ms = 15000) => {
    for (let i = 0; i < ms / 100; i += 1) { if (fn()) return true; await wait(100); }
    return false;
  };

  window.__tsc.setTech(false);
  window.__tsc.setAuto(true);
  await wait(150);

  // --- 1. zestaw kolumn
  const kol = [...document.querySelectorAll('#grid col')].map((c) => c.dataset.col);
  const naglowki = [...document.querySelectorAll('#grid thead th')].map((t) => t.querySelector('.label').textContent);
  log.push(`[1] kolumny domyslne (${kol.length}): ${kol.join(', ')}`);
  log.push(`[1] naglowki: ${naglowki.join(' | ')}`);

  // --- 2. status jako kropka, nie kolumna
  const maKolumneStatus = kol.includes('status');
  const kropki = document.querySelectorAll('#tb .dot').length;
  const wierszy = document.querySelectorAll('#tb tr').length;
  log.push(`[2] kolumna Status istnieje: ${maKolumneStatus} | kropek w ${wierszy} wierszach: ${kropki}`);

  // --- 3. warunkowe przyciski w wierszu
  const przyciskow = document.querySelectorAll('#tb button').length;
  const martwych = document.querySelectorAll('#tb button:disabled').length;
  const resetow = document.querySelectorAll('#tb button[data-a="reset"]').length;
  const abek = document.querySelectorAll('#tb button[data-a="playOrig"]').length;
  log.push(`[3] przyciskow w tabeli: ${przyciskow} (wyszarzonych: ${martwych})`);
  log.push(`[3] "Przywroc" tylko przy zmienionych: ${resetow}, A/B tylko przy podmienionych: ${abek}`);

  // --- 4. chipy statusow jako filtr
  const chipy = [...document.querySelectorAll('#chips button[data-chip]')].map((c) => c.textContent.trim());
  log.push(`[4] chipy: ${chipy.length ? chipy.join(' | ') : '(brak - wszystko oryginalne)'}`);
  const chip = document.querySelector('#chips button[data-chip]:not(.clear)');
  if (chip) {
    chip.click();
    await wait(200);
    log.push(`[4] po klikniecu chipa "${chip.dataset.chip}": widocznych wierszy ${document.querySelectorAll('#tb tr').length}`);
    const clear = document.querySelector('#chips button[data-chip=""]');
    if (clear) { clear.click(); await wait(200); }
    log.push(`[4] po wyczyszczeniu: ${document.querySelectorAll('#tb tr').length} wierszy`);
  }

  // --- 5. pasy warunkowe
  const bany = [...document.querySelectorAll('#banners .banner')].map((b) => b.textContent.trim().slice(0, 70));
  log.push(`[5] pasy warunkowe: ${bany.length ? bany.join(' // ') : '(zaden - wszystko dziala)'}`);

  // --- 6. przycisk-kontekst zamiast sciezki i plakietek
  log.push(`[6] kontekst klienta: "${document.getElementById('clientLabel').textContent}"`);
  log.push(`[6] plakietki w naglowku: ${document.querySelectorAll('header .pill').length}`);
  log.push(`[6] elementow sterujacych w naglowku: ${document.querySelectorAll('header button, header input, header select').length}`);

  // --- 7. menu
  document.getElementById('btnMenu').click();
  await wait(150);
  const pozycje = [...document.querySelectorAll('#menu button')].map((b) => b.textContent.trim());
  log.push(`[7] menu otwarte: ${!document.getElementById('menu').hidden}`);
  log.push(`[7] pozycje: ${pozycje.join(' | ')}`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  log.push(`[7] Escape zamyka menu: ${document.getElementById('menu').hidden}`);

  // --- 8. kolumny techniczne
  window.__tsc.setTech(true);
  await wait(200);
  const kolTech = [...document.querySelectorAll('#grid col')].map((c) => c.dataset.col);
  log.push(`[8] po wlaczeniu szczegolow (${kolTech.length}): ${kolTech.join(', ')}`);
  window.__tsc.setTech(false);
  await wait(200);
  log.push(`[8] po wylaczeniu wracamy do ${document.querySelectorAll('#grid col').length} kolumn`);

  // --- 9. przelacznik odtwarzania
  const play = row(RAID).querySelector('button[data-a="play"]');
  const przed = play.innerHTML;
  play.click();
  await waitFor(() => play.classList.contains('on'), 4000);
  const wTrakcie = play.innerHTML;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(300);
  log.push(`[9] play: "${przed}" -> "${wTrakcie}" -> "${play.innerHTML}" | Escape zatrzymal: ${!play.classList.contains('on')}`);

  // --- 10. menu kontekstowe wiersza
  row(RAID).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }));
  await wait(150);
  const rm = document.getElementById('rowMenu');
  const widoczne = [...rm.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.textContent.trim());
  log.push(`[10] menu wiersza (oryginal): ${widoczne.join(' | ')}`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);

  // --- 11. wyciszenie przeniesione do okna podmiany
  row(RAID).querySelector('button[data-a="replace"]').click();
  await waitFor(() => !document.getElementById('replace').hidden, 4000);
  log.push(`[11] w oknie podmiany jest opcja "Cisza": ${Boolean(document.getElementById('btnSilence'))}`);
  log.push(`[11] tytul okna: "${document.getElementById('replaceTarget').textContent}"`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(250);
  log.push(`[11] Escape zamknal okno: ${document.getElementById('replace').hidden}`);

  // --- 12. wyszukiwarka: waski indeks
  const q = document.getElementById('q');
  q.value = 'nse#';
  q.dispatchEvent(new Event('input'));
  await wait(250);
  const poRef = document.querySelectorAll('#tb tr').length;
  q.value = 'raid';
  q.dispatchEvent(new Event('input'));
  await wait(250);
  const poNazwie = document.querySelectorAll('#tb tr').length;
  q.value = '';
  q.dispatchEvent(new Event('input'));
  await wait(250);
  log.push(`[12] szukanie po ref "nse#": ${poRef} wynikow (ma byc 0 - ref wypadl z indeksu)`);
  log.push(`[12] szukanie po nazwie "raid": ${poNazwie} wynikow`);

  // --- 13. glosnosc przezywa zapis
  const vol = document.getElementById('vol');
  vol.value = '0.35';
  vol.dispatchEvent(new Event('input'));
  await wait(100);
  log.push(`[13] glosnosc zapisana: ${localStorage.getItem('volume')}`);

  // --- 14. szerokosc
  const main = document.querySelector('main');
  log.push(`[14] tabela ${document.getElementById('grid').style.width}, lista ${main.clientWidth}px, przewijanie w bok: ${main.scrollWidth > main.clientWidth + 1}`);

  return log.join('\n');
})()
