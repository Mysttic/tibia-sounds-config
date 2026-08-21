# Testy

```bash
npm test           # caly zestaw
npm run test:watch # w petli, przy pracy nad modulem
npm run verify     # ikona + testy, to samo co CI
```

Uzywamy wbudowanego `node --test`. Zero frameworkow, zero konfiguracji.

## Podzial

| plik | co sprawdza | ffmpeg |
|---|---|---|
| `tests/protobuf.test.js` | varinty, wire typy, packed, odpornosc na uciete bufory | nie |
| `tests/soundBank.test.js` | wszystkie piec sekcji `Sounds`, ignorowanie nieznanych pol | nie |
| `tests/descriptors.test.js` | parsowanie `FileDescriptorProto`, szukanie blobu w binarce, fallback | nie |
| `tests/clientPaths.test.js` | wykrywanie klienta, wyrozumialosc na wskazany podkatalog | nie |
| `tests/catalog.test.js` | macierz statusow, mapowanie akcji, cache hashy | nie |
| `tests/changelog.test.js` | wyciaganie sekcji wydania z `CHANGELOG.md` | nie |
| `tests/icon.test.js` | enkoder PNG, aktualnosc `build/icon.png` | nie |
| `tests/audio.test.js` | odczyt naglowkow ogg, konwersja, cisza, obsluga bledow | **tak** |
| `tests/lifecycle.test.js` | pelny cykl podmiana &rarr; reset &rarr; drift &rarr; reapply | **tak** |

Testy wymagajace ffmpega same sie pomijaja, gdy go nie ma (`tests/helpers/env.js`),
z czytelnym powodem w wyniku. CI ma ffmpega zainstalowanego, wiec tam leca wszystkie.

## Fixture

`tools/make-fixture.js` buduje syntetycznego mini-klienta w `%TEMP%`:

- `createRawFixture()`: pliki o deterministycznej tresci nazwane wlasnym sha256.
  Bez ffmpega. Wystarcza do testow parsera, statusow i sciezek.
- `createFixture()`: prawdziwe pliki Vorbis wygenerowane ffmpegiem (rozne
  czestotliwosci probkowania i liczby kanalow). Potrzebne tam, gdzie liczy sie
  faktyczne audio.

Oba warianty maja ten sam bank: 3 dzwieki, 3 `NumericSoundEffect` (w tym jeden
`RandomSoundEffect` z packed varintami), `AmbienceStream`, `AmbienceObjectStream`
i `MusicTemplate`, czyli komplet sekcji.

```bash
npm run fixture               # zbuduj i wypisz sciezke, do recznego pogrzebania
```

Zadnych assetow CipSoftu w repo, zadnego dotykania prawdziwej instalacji.

## Weryfikacja na prawdziwym kliencie

Do sprawdzenia na realnych danych sluzy **kopia** klienta w `testclient/`:

```bash
robocopy "%LOCALAPPDATA%\Tibia" "%CD%\testclient" /E /MT:8
```

Nigdy nie testujemy na dzialajacej instalacji.

Aplikacje uruchamiamy z wlaczonym CDP i sprawdzamy stan interfejsu bez robienia
screenshotow:

```bash
npx electron . --remote-debugging-port=9222
node tools/cdp-probe.js "document.querySelectorAll('#tb tr').length"
node tools/cdp-probe.js --file tools/e2e-probe.js
```

`tools/cdp-probe.js` laczy sie z rendererem po Chrome DevTools Protocol i wykonuje
w nim wyrazenie. Gotowe scenariusze:

| plik | scenariusz |
|---|---|
| `tools/e2e-probe.js` | odtwarzanie &rarr; podmiana &rarr; A/B &rarr; wyciszenie &rarr; reset z kopii `___` |
| `tools/e2e-drift.js` | reakcja na patch launchera i pas *Przywroc moje* |
| `tools/e2e-columns.js` | szerokosci kolumn, kolumny techniczne, dopasowanie do tresci, zapis ustawien |
| `tools/e2e-ui-1-4.js` | odchudzony interfejs: kropka statusu, warunkowe przyciski, chipy, menu |
| `tools/e2e-packaged.js` | to samo na spakowanej aplikacji z `dist/win-unpacked` |

Skrypty czytaja komorki przez `td[data-col="..."]` i steruja aplikacja przez
`window.__tsc` (`refresh`, `setTech`, `setAuto`, `fit`, `entries`). Nie klikaja po
identyfikatorach przyciskow ani nie licza kolumn po indeksie, bo jedno i drugie
rozsypywalo sie przy kazdej zmianie ukladu.

Krok "drift" wymaga nadpisania pliku z zewnatrz. To symulacja tego, co robi
launcher przy weryfikacji assetow:

```bash
V=$(ls -d vault/clients/testclient-*/)
F=sound-e3e1a76bce58857fbb12d6a3d5992ac8598de8eab331109f18b9634f0a9c7196.ogg
cp "$V/originals/$F" "testclient/packages/Tibia/sounds/$F"
node tools/cdp-probe.js --file tools/e2e-drift.js
```

Spakowana aplikacja (inny `userData`, zasoby w `app.asar`):

```bash
npx electron-builder --dir --win
"./dist/win-unpacked/Tibia Sounds Config.exe" --remote-debugging-port=9223
CDP_PORT=9223 node tools/cdp-probe.js --file tools/e2e-packaged.js
```

## Co warto sprawdzic przy zmianach w obsludze plikow

1. status wraca do `oryginal` po resecie (`sha256` zgodne z nazwa pliku)
2. kopia oryginalu w vaulcie nie zostala nadpisana podmianka
3. zapis jest atomowy, w katalogu klienta nie zostaja pliki `.tmp-*`
4. przy uruchomionym kliencie Tibii operacja jest odrzucana z czytelnym komunikatem
