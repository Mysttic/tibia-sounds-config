# Wersja

1.7.0

---

Ten plik jest **zrodlem prawdy** dla numeru wersji aplikacji.

Wersja to pierwszy w pliku samodzielny numer w formacie
[SemVer](https://semver.org/lang/pl/) (`MAJOR.MINOR.PATCH`, opcjonalnie z
przedrostkiem `v` i sufiksem typu `-rc.1`). Dekoracje markdown wokol niego
(naglowek, pogrubienie, punktor) sa ignorowane.

## Jak podbic wersje

1. Zmien numer powyzej.
2. `npm run version:sync`, ktory przepisze go do `package.json`.
3. Dopisz sekcje `## [<wersja>]` w [`CHANGELOG.md`](CHANGELOG.md).
4. PR `develop` &rarr; `master`. Po merge workflow sam zbuduje instalatory,
   otaguje `v<wersja>` i opublikuje release.

Merge do `master` **bez** podbicia tego numeru niczego nie publikuje, bo workflow
sprawdza, czy tag `v<wersja>` juz istnieje, i konczy sie bez akcji.

CI pilnuje, zeby `VERSION.md` i `package.json` sie zgadzaly (`npm run version:check`).
Numer stad trafia tez na pasek aplikacji i do tytulu okna.
