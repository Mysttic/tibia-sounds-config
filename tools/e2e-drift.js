/* eslint-disable */
/**
 * Druga czesc E2E: sprawdza reakcje na patch launchera.
 * Uruchamiac PO tym, jak z zewnatrz nadpisano plik dzwieku jego oryginalem
 * (patrz README, sekcja "Weryfikacja").
 *
 * Od 1.4.0 "Zastosuj ponownie" nie jest przyciskiem w pasku, tylko pasem
 * warunkowym nad tabela - pojawia sie tylko wtedy, gdy jest co przywracac.
 */
(async () => {
  const UI = 675;
  const log = [];

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tsc.setTech(true);

  const row = (id) => document.querySelector(`#tb tr[data-id="${id}"]`);
  const st = (id) => row(id).dataset.status;
  const cell = (id, col) => {
    const td = row(id) && row(id).querySelector(`td[data-col="${col}"]`);
    return td ? td.textContent.trim() : '(brak kolumny)';
  };
  const refresh = async () => { await window.__tsc.refresh(); await wait(250); };
  const banner = () => document.querySelector('#banners button[data-b="reapply"]');
  const chips = () => document.getElementById('chips').textContent.trim();

  await refresh();
  log.push(`[1] po "patchu launchera": UI=${st(UI)} | ${cell(UI, 'size')} | ${cell(UI, 'durationSec')}`);
  log.push(`[1] pas "Przywroc moje" widoczny: ${Boolean(banner())}`);
  log.push(`[1] tresc pasa: "${document.getElementById('banners').textContent.trim().slice(0, 90)}"`);
  log.push(`[1] chipy: ${chips()}`);

  banner().click();
  for (let i = 0; i < 100; i += 1) {
    await wait(100);
    if (document.getElementById('msg').textContent.includes('Przywrocono')) break;
  }
  await wait(300);

  log.push(`[2] komunikat: ${document.getElementById('msg').textContent}`);
  log.push(`[2] UI po reapply: ${st(UI)} | ${cell(UI, 'size')} | ${cell(UI, 'durationSec')}`);
  log.push(`[2] pas zniknal: ${!banner()}`);

  // sprzatanie
  await api.resetSound(UI);
  await api.resetSound(677);
  await refresh();
  log.push(`[3] po sprzataniu: ui=${st(UI)} raid=${st(677)} | chipy: "${chips()}"`);

  return log.join('\n');
})()
