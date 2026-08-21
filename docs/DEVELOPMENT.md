# Praca ze zrodlami

Strona dla programistow i osob, ktore chca zbudowac aplikacje samodzielnie
zamiast ufac gotowym plikom z Releases.

## Wymagania

- Node.js >= 20.11 (CI uzywa 22)
- `ffmpeg` z enkoderem `libvorbis` w `PATH` (albo sciezka w zmiennej `FFMPEG_PATH`).
  Bez niego dziala przegladanie i odsluch, nie dziala konwersja i wyciszanie

## Uruchomienie ze zrodel

```bash
git clone https://github.com/Mysttic/tibia-sounds-config.git
cd tibia-sounds-config
npm install
npm start
```

Albo dwuklik w `start.bat`: w katalogu zrodel doinstaluje zaleznosci i odpali
`npm start`, a obok zainstalowanej aplikacji uruchomi `.exe`.

Aplikacja sama szuka klienta w `%LOCALAPPDATA%\Tibia` i `Program Files\Tibia`
(oraz odpowiednikach na macOS/Linux). Inny katalog wskazuje sie przyciskiem-kontekstem
na gornym pasku aplikacji (tym z nazwa i wersja klienta).

## Skad sie biora nazwy akcji

Klient trzyma bank dzwiekow w protobufie, a nazwy typow w deskryptorach
wkompilowanych w `client.exe`:

```
<klient>/packages/Tibia/sounds/catalog-sound.json
   -> sounds-<sha256>.dat          (tibia.protobuf.sound.Sounds)
        Sound                      id -> "sound-<sha256>.ogg"
        NumericSoundEffect         id == wartosc ESoundEffectType, typ == ENumericSoundType
        AmbienceStream             petla tla + opoznione efekty
        AmbienceObjectStream       petle zalezne od liczby obiektow na ekranie
        MusicTemplate              muzyka

<klient>/packages/Tibia/bin/client.exe
   -> FileDescriptorProto dla sounds-common.proto
        ESoundEffectType    336 nazw
        ENumericSoundType   20 kategorii miksera
        EMusicType          4 wartosci
```

Nazwy sa czytane z **wskazanej** instalacji, wiec nowsze wersje klienta dostaja
nowe nazwy automatycznie. Gdy skan `client.exe` sie nie uda, aplikacja wraca do
`data/enums.snapshot.json` (snapshot z klienta 15.32.df7b29) i sygnalizuje to
w pasku. Pelny opis formatu: [SOUND_FORMAT.md](SOUND_FORMAT.md).

## Testy

```bash
npm test           # caly zestaw
npm run verify     # zgodnosc wersji + ikona + testy, to samo co CI
```

Testy buduja syntetycznego mini-klienta w `%TEMP%` i przechodza pelny cykl:
podmiana &rarr; wyciszenie &rarr; reset &rarr; drift &rarr; ponowne wgranie
&rarr; obcy plik &rarr; reset z kopii `___`. Zadnych assetow CipSoftu w repo,
zadnego dotykania prawdziwej instalacji. Testy zalezne od ffmpega same sie
pomijaja, gdy go nie ma.

Do testow na realnych danych sluzy **kopia** klienta w `testclient/` (gitignore):

```bash
robocopy "%LOCALAPPDATA%\Tibia" "%CD%\testclient" /E /MT:8
```

Szczegoly i sondy CDP do testowania UI: [TESTING.md](TESTING.md).

## Build

```bash
npm run pack       # rozpakowana aplikacja -> dist/win-unpacked
npm run dist:win   # instalator NSIS + portable -> dist/
```

Numer wersji ma jedno zrodlo prawdy: [`VERSION.md`](../VERSION.md). Stad trafia
do `package.json` (`npm run version:sync`), na pasek aplikacji i do tytulu okna.

Wydanie powstaje automatycznie po merge PR-a `develop` &rarr; `master`, o ile numer
w `VERSION.md` zostal podbity. Szczegoly i znane problemy z buildem na Windows:
[RELEASING.md](RELEASING.md).

## Uklad repo

```
electron/main.js        proces glowny: okno, IPC, protokol tsound://
electron/preload.js     contextBridge, jedyny most do systemu plikow
electron/lib/           protobuf, soundBank, descriptors, clientPaths, catalog,
                        audio, profile, processes
renderer/               tabela, filtry, odtwarzanie, akcje
data/                   enums.snapshot.json: nazwy akcji z klienta 15.32
docs/                   dokumentacja + wygenerowane raporty
tools/                  generator ikony, fixture, sonda CDP, skrypty RE w Pythonie
tests/                  node --test
build/                  zasoby buildu (icon.png generowana kodem)
```

`tools/*.py` to skrypty, ktorymi format klienta zostal rozgryziony. Nie sa
potrzebne do dzialania aplikacji, zostaja jako slad pochodzenia i punkt
odniesienia przy sprawdzaniu portu na JavaScript.

## Dokumentacja

| dokument | o czym |
|---|---|
| [JAK_TO_DZIALA.md](JAK_TO_DZIALA.md) | co aplikacja robi z plikami, wersja dla uzytkownika |
| [SOUND_FORMAT.md](SOUND_FORMAT.md) | format banku, enumy, statystyki, jak to ustalono |
| [ARCHITECTURE.md](ARCHITECTURE.md) | podzial procesow, moduly, przeplyw danych, bezpieczenstwo |
| [TESTING.md](TESTING.md) | zestaw testow, fixture, sondy CDP |
| [RELEASING.md](RELEASING.md) | build, wydania, znane problemy z Windows |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | galezie, konwencje, granice projektu |
| [sound_actions.md](sound_actions.md) | wygenerowany raport: wszystkie efekty, streamy, muzyka |
| [sound_map.csv](sound_map.csv) | mapa plik &rarr; akcja dla klienta 15.32 |
