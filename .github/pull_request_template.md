## Co i po co

<!-- Jedno-dwa zdania: co ta zmiana robi i jaki problem rozwiazuje. -->

## Jak sprawdzone

<!-- Konkretnie. "Odpalilem testy" to za malo - napisz co widziales. -->

- [ ] `npm test` przechodzi
- [ ] sprawdzone recznie w aplikacji (`npm start`) na **kopii** klienta, nie na dzialajacej instalacji
- [ ] jesli zmiana dotyka zapisu plikow: przeszedlem cykl podmiana -> reset i status wrocil do `oryginal`

## Wersja i changelog

- [ ] wpis w `CHANGELOG.md`
- [ ] `version` w `package.json` podbite, jesli ta zmiana ma trafic do wydania
      (merge do `master` bez podbicia wersji **nie** utworzy release'u)

## Ryzyko

<!-- Co moze pojsc nie tak? Czy zmiana dotyka zapisu do katalogu klienta? -->
