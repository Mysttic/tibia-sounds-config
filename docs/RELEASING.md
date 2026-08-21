# Build i wydania

## Zasada

Numer wersji ma jedno zrodlo prawdy: [`VERSION.md`](../VERSION.md).
`package.json` tylko go powtarza, bo z niego korzysta electron-builder przy nazywaniu
artefaktow. Zgodnosc pilnuje `npm run version:check` w CI.

Merge PR-a `develop` &rarr; `master` uruchamia workflow
[Release](../.github/workflows/release.yml), ktory:

1. sprawdza, czy `VERSION.md` i `package.json` maja ten sam numer (rozjazd = stop, zanim cokolwiek sie zbuduje)
2. czyta wersje z `VERSION.md` i sprawdza, czy tag `v<wersja>` juz istnieje
3. **jesli istnieje, konczy bez publikacji** (merge poprawki dokumentacji nic nie psuje)
4. jesli nie, odpala testy, buduje instalatory, tworzy tag i GitHub Release
   z trescia z `CHANGELOG.md`

Wniosek praktyczny: **wydanie = podbicie numeru w `VERSION.md` w PR do master.**

## Procedura wydania

```bash
git switch develop
git pull
```

1. Podbij numer w `VERSION.md` (semver: patch / minor / major).
2. Przepisz go do `package.json`:

```bash
npm run version:sync
```

3. Opisz zmiany w `CHANGELOG.md` pod naglowkiem `## [<wersja>] - RRRR-MM-DD`
   (sekcja `Unreleased` zostaje pusta).
4. Sprawdz lokalnie to, co sprawdzi CI:

```bash
npm run verify
```

5. Commit i push:

```bash
git add VERSION.md package.json CHANGELOG.md
git commit -m "wydanie 1.1.0"
git push
```

Potem PR `develop` &rarr; `master`, review, merge. Reszta dzieje sie sama.

Po merge:

- workflow tworzy tag `v<wersja>` i release z artefaktami
- tresc release'u to sekcja `## [<wersja>]` z `CHANGELOG.md` plus stale zastrzezenie
  (projekt nieoficjalny, zmiana czysto kosmetyczna, modyfikacja na wlasna odpowiedzialnosc)

Numer z `VERSION.md` trafia tez na pasek aplikacji (obok nazwy) i do tytulu okna.
Plik jest dolaczany do paczki, wiec zainstalowana aplikacja pokazuje dokladnie
to, co bylo w repo w chwili buildu.

Gdy trzeba wydac ponownie ten sam numer (np. artefakt sie nie zbudowal), uzyj
`workflow_dispatch` z opcja **force**, ktora nadpisze tag i release.

## Artefakty

| plik | co to |
|---|---|
| `tibia-sounds-config-<wersja>-win-x64-setup.exe` | instalator NSIS, per-user, z wyborem katalogu |
| `tibia-sounds-config-<wersja>-win-x64-portable.exe` | wersja portable, bez instalacji |
| `*.blockmap`, `latest.yml` | metadane electron-buildera |

Konfiguracja: [`electron-builder.yml`](../electron-builder.yml). Do paczki wchodza
tylko `electron/`, `renderer/`, `data/` i `package.json`. Katalogi `tests/`, `tools/`,
`docs/`, `testclient/` i `vault/` zostaja poza instalatorem.

## Dodanie kolejnej platformy

`electron-builder.yml` ma gotowe sekcje `linux` (AppImage + deb) i `mac` (dmg).
Zeby je wlaczyc, odkomentuj odpowiedni wpis w macierzy `build` w
[`release.yml`](../.github/workflows/release.yml):

```yaml
- os: ubuntu-latest
  name: linux
  builder: --linux
  artifacts: |
    dist/*.AppImage
    dist/*.deb
```

Wszystkie artefakty trafiaja do jednego release'u (`download-artifact` z
`merge-multiple: true`), wiec nic poza tym nie trzeba zmieniac.

Uwaga do macOS: bez certyfikatu Apple Developer buildy nie beda podpisane ani
notaryzowane, wiec Gatekeeper pokaze ostrzezenie przy pierwszym uruchomieniu.

## Build lokalny

```bash
npm run icon      # build/icon.png z tools/make-icon.js
npm run pack      # tylko rozpakowana aplikacja -> dist/win-unpacked
npm run dist:win  # pelne instalatory -> dist/
```

### Znany problem na Windows: "Cannot create symbolic link"

`npm run dist:win` moze wywalic sie na rozpakowywaniu paczki `winCodeSign`:

```
ERROR: Cannot create symbolic link : Klient nie ma wymaganych uprawnien.
  ...winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

Paczka zawiera dowiazania symboliczne dla macOS, a Windows pozwala je tworzyc tylko
przy wlaczonym trybie dewelopera albo z podniesionymi uprawnieniami. electron-builder
potrzebuje tej paczki nie do podpisywania (nie podpisujemy), tylko do `rcedit`, ktory
wpisuje ikone i metadane do `.exe`.

Sprawdzenie, czy to ten przypadek:

```cmd
mklink test.lnk C:\Windows\win.ini
```

Jesli widzisz "You do not have sufficient privilege", to jest to. Rozwiazania:

1. **Ustawienia &rarr; Prywatnosc i zabezpieczenia &rarr; Dla deweloperow &rarr; Tryb dewelopera** (na stale)
2. jednorazowo: uruchom terminal jako administrator i odpal `npm run dist:win`
   (paczka rozpakuje sie do cache i kolejne buildy pojda juz normalnie)
3. sam `npm run pack` (bez instalatora) dziala bez uprawnien, wystarczy do
   sprawdzenia, czy aplikacja sie sklada i uruchamia

Na `windows-latest` w GitHub Actions problem nie wystepuje, bo runner ma uprawnienia
do tworzenia dowiazan. Gdyby kiedys wystapil, ten sam workaround (krok
z podniesionymi uprawnieniami) dziala i tam.

## Podpisywanie kodu

Nie podpisujemy. Instalator nie ma certyfikatu, wiec SmartScreen pokaze ostrzezenie
"Windows protected your PC" przy pierwszym uruchomieniu. To normalne dla
niepodpisanych aplikacji.

Gdyby doszedl certyfikat: `electron-builder` czyta `CSC_LINK` (base64 pliku `.pfx`)
i `CSC_KEY_PASSWORD` ze zmiennych srodowiskowych. W workflowie trzeba wtedy podac je
z sekretow repo i usunac `CSC_IDENTITY_AUTO_DISCOVERY: false`.

## Checklist przed merge do master

- [ ] `npm run verify` przechodzi lokalnie
- [ ] wersja w `package.json` podbita
- [ ] `CHANGELOG.md` ma sekcje dla tej wersji
- [ ] `npm run pack` sie sklada, aplikacja z `dist/win-unpacked` startuje i wczytuje klienta
- [ ] przetestowane na `testclient/`, nie na dzialajacej instalacji
