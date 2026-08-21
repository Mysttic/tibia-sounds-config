/* eslint-disable */
/**
 * Sprawdza zachowanie kolumn: dopasowanie do szerokosci okna, minimalne szerokosci,
 * tryb auto, reczne przeciaganie, dopasowanie pojedynczej kolumny dwuklikiem,
 * przelaczanie kolumn technicznych i zapis ustawien.
 *
 *   node tools/cdp-probe.js --file tools/e2e-columns.js
 *
 * Minima czytamy z window.__tsc.columns, a nie z recznie przepisanej kopii -
 * poprzednia wersja miala wlasna mape, ktora po zmianie COLUMNS rozjezdzala sie w ciszy.
 */
(async () => {
  const log = [];
  const main = document.querySelector('main');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const MIN = Object.fromEntries(window.__tsc.columns.map((c) => [c.key, c.min]));
  const liveCols = () => [...document.querySelectorAll('#grid col')];
  const widthOf = (name) => parseInt(document.querySelector(`#grid col[data-col="${name}"]`).style.width, 10);
  const total = () => liveCols().reduce((a, c) => a + parseInt(c.style.width, 10), 0);
  const scrolls = () => main.scrollWidth > main.clientWidth + 1;
  const saved = () => JSON.parse(localStorage.getItem('columns.v3') || '{}');
  const thOf = (name) => document.querySelector(`#grid thead th[data-col="${name}"]`);

  const drag = (name, dx) => {
    const handle = thOf(name).querySelector('.resizer');
    const box = handle.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + dx, clientY: y, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: x + dx, clientY: y, bubbles: true }));
  };

  // --- domyslny zestaw kolumn
  window.__tsc.setTech(false);
  window.__tsc.setAuto(true);
  await wait(80);

  const widoczne = liveCols().map((c) => c.dataset.col);
  const minSum = widoczne.reduce((a, k) => a + MIN[k], 0);
  log.push(`[0] kolumny domyslne: ${widoczne.join(', ')}`);
  log.push(`[0] suma minimow: ${minSum}px (MIN_WINDOW_WIDTH w main.js ma byc >= tej liczby)`);
  log.push(`[0] okno ${window.innerWidth}px, lista ${main.clientWidth}px, tabela ${total()}px, przewijanie: ${scrolls()}`);

  // --- symulacja waskiego okna: podmieniamy to, co czyta fitColumns
  const real = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  const fakeWidth = (px) => Object.defineProperty(main, 'clientWidth', { value: px, configurable: true });
  const restoreWidth = () => Object.defineProperty(main, 'clientWidth', real);

  for (const width of [900, 700, minSum, minSum - 120]) {
    fakeWidth(width);
    window.__tsc.fit();
    await wait(40);
    const below = liveCols()
      .filter((c) => parseInt(c.style.width, 10) < MIN[c.dataset.col])
      .map((c) => c.dataset.col);
    log.push(`[1] lista ${width}px -> tabela ${total()}px, miesci sie: ${total() <= width}, ponizej minimum: ${below.length ? below.join(',') : 'brak'}`);
  }

  restoreWidth();
  window.__tsc.fit();
  await wait(60);
  log.push(`[2] po powrocie do pelnej szerokosci: tabela ${total()}px, przewijanie: ${scrolls()}`);

  // --- auto nadaza za filtrem
  const before = widthOf('event');
  const q = document.getElementById('q');
  q.value = 'raid';
  q.dispatchEvent(new Event('input'));
  await wait(200);
  const filtered = widthOf('event');
  q.value = '';
  q.dispatchEvent(new Event('input'));
  await wait(200);
  log.push(`[3] kolumna nazwy przy filtrze "raid": ${before} -> ${filtered} -> ${widthOf('event')}px`);

  // --- kolumny techniczne
  window.__tsc.setTech(true);
  await wait(120);
  const tech = liveCols().map((c) => c.dataset.col);
  log.push(`[4] po wlaczeniu szczegolow: ${tech.join(', ')} (tabela ${total()}px)`);
  const techSum = tech.reduce((a, k) => a + MIN[k], 0);
  log.push(`[4] suma minimow w trybie technicznym: ${techSum}px`);
  window.__tsc.setTech(false);
  await wait(120);
  log.push(`[4] po wylaczeniu wracamy do ${liveCols().length} kolumn`);

  // --- reczne przeciagniecie wylacza auto
  drag('category', 120);
  await wait(80);
  log.push(`[5] po przeciagnieciu Kategorii +120: ${widthOf('category')}px, auto=${window.__tsc.auto}`);
  log.push(`[5] zapisane: auto=${saved().auto}, category=${saved().widths.category}px`);

  // --- przy wylaczonym auto zmiana filtra nie rusza kolumn
  const manual = widthOf('category');
  q.value = 'spell';
  q.dispatchEvent(new Event('input'));
  await wait(200);
  log.push(`[6] przy auto=false filtr nie zmienia szerokosci: ${widthOf('category') === manual}`);
  q.value = '';
  q.dispatchEvent(new Event('input'));
  await wait(200);

  // --- dwuklik dopasowuje pojedyncza kolumne do tresci
  thOf('category').querySelector('.resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await wait(80);
  const td = document.querySelector('#tb tr td[data-col="category"]');
  log.push(`[7] dwuklik na Kategorie -> ${widthOf('category')}px, cala tresc widoczna: ${td.scrollWidth <= td.clientWidth}`);

  // --- minimum przy recznym zwezaniu
  drag('category', -400);
  await wait(80);
  log.push(`[8] proba zwezenia Kategorii do zera: ${widthOf('category')}px (minimum reczne to 44)`);

  // --- powrot do auto
  window.__tsc.setAuto(true);
  await wait(150);
  log.push(`[9] po wlaczeniu auto: tabela ${total()}px, przewijanie: ${scrolls()}, zapisane auto=${saved().auto}`);

  return log.join('\n');
})()
