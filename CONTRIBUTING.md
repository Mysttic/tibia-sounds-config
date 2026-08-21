# Praca nad projektem

## Zasada numer jeden

**Nie testujemy na dzialajacej instalacji Tibii.** Do testow sluzy kopia w `testclient/`.
Aplikacja nadpisuje pliki w katalogu klienta, a pomylka na zywej instalacji oznacza
w najlepszym razie koniecznosc weryfikacji plikow launcherem.

```bash
robocopy "%LOCALAPPDATA%\Tibia" "%CD%\testclient" /E /MT:8
```

`testclient/` jest w `.gitignore`. Nigdy nie commituj plikow klienta. `.gitignore`
blokuje `*.ogg`, `*.dat`, `client.exe` i `packages/`, ale warto sprawdzic `git status`
przed commitem.

## Srodowisko

- Node >= 20.11 (CI uzywa 22)
- `ffmpeg` z enkoderem `libvorbis` w `PATH` albo sciezka w `FFMPEG_PATH`

```bash
npm install
npm start          # aplikacja
npm test           # testy
npm run verify     # ikona + testy, to samo co robi CI
```

Testy zalezne od ffmpega same sie pomijaja, gdy go nie ma; reszta (parser banku,
deskryptory, statusy, sciezki) dziala bez niego.

## Galezie i przeplyw pracy

```
feature/cos  ──PR──>  develop  ──PR──>  master  ──automat──>  GitHub Release
```

- `master`: wydany kod. Kazdy push tutaj uruchamia workflow release'owy;
  publikuje tylko wtedy, gdy numer w [`VERSION.md`](VERSION.md) zostal podbity.
- `develop`: galaz integracyjna, tu laduje codzienna praca.
- `feature/*`, `fix/*`: galezie robocze, PR do `develop`.

PR do `develop` i do `master` uruchamia [CI](.github/workflows/ci.yml): testy na
Windows i Linuksie plus probny build instalatora.

## Konwencje

- Kod i komentarze po polsku bez ogonkow (spojne z reszta repo, zero problemow z kodowaniem
  w konsoli Windows). Teksty widoczne dla uzytkownika w rendererze tak samo.
- Komunikaty commitow w trybie rozkazujacym: `dodaj filtr statusu`, `napraw detekcje ffmpeg`.
- Bez zaleznosci runtime. Wszystko, co aplikacja robi w trakcie dzialania, ma byc oparte
  o wbudowane moduly Node i Electrona. `devDependencies` sa w porzadku.
- Nowa funkcja = test. Logika bez plikow (statusy, parsery) to test jednostkowy,
  operacje na plikach to test na fixture z `tools/make-fixture.js`.

## Gdzie co jest

Podzial modulow i przeplyw danych: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Format banku dzwiekow: [docs/SOUND_FORMAT.md](docs/SOUND_FORMAT.md).
Jak testowac: [docs/TESTING.md](docs/TESTING.md).
Jak wydac wersje: [docs/RELEASING.md](docs/RELEASING.md).

## Granice, ktorych nie przekraczamy

Aplikacja zapisuje wylacznie do:

- `<klient>/packages/Tibia/sounds/sound-<sha256>.ogg`, gdzie nazwa jest walidowana wzorcem,
  wiec nie da sie wyjsc poza katalog
- wlasnego vaulta (`vault/` w trybie deweloperskim, `userData/vault` w spakowanej aplikacji)

Nigdy nie ruszamy `assets.json`, `package.json` klienta, plikow `.dat` ani binariow.
Jesli zmiana wymaga wyjscia poza te granice, to temat na dyskusje w issue, nie na PR.
