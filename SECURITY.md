# Zgłaszanie problemów bezpieczeństwa

## Jak zgłosić

Nie zakładaj publicznego zgłoszenia (issue) dla problemu bezpieczeństwa.

Użyj **[prywatnego zgłaszania podatności na GitHubie](https://github.com/Mysttic/tibia-sounds-config/security/advisories/new)**
(zakładka *Security* → *Report a vulnerability*). Zgłoszenie widzi tylko autor
projektu, dopóki poprawka nie zostanie wydana.

To projekt prowadzony po godzinach przez jedną osobę. Nie obiecuję czasu reakcji
ani nagrody za zgłoszenie. Obiecuję, że przeczytam, odpowiem i, jeśli problem jest
realny, opiszę go uczciwie w `CHANGELOG.md`, razem z tym, czego dotyczył.

## Co jest w zakresie

Aplikacja zapisuje pliki w katalogu gry i przechowuje klucz API użytkownika, więc
szczególnie interesują mnie zgłoszenia dotyczące:

- **wyjścia poza katalog dźwięków**: zapis lub odczyt pliku spoza
  `<klient>/packages/Tibia/sounds` oraz katalogu roboczego aplikacji,
- **protokołu `tsound://`**: to jedyna bariera między nazwą przysłaną przez okno
  aplikacji a odczytem pliku z dysku (`electron/lib/tsound.js`),
- **przechowywania klucza API**: klucz nie może trafić na dysk jawnym tekstem ani
  opuścić procesu głównego (`electron/lib/secrets.js`),
- **warstwy sieciowej**: obejścia wymogu `https`, limitu rozmiaru pobrania albo
  limitu czasu (`electron/lib/net.js`),
- **izolacji okna aplikacji**: wykonania kodu w rendererze, obejścia `contextIsolation`,
  CSP albo mostu `preload.js`,
- **utraty danych użytkownika**: scenariuszy, w których podmianka albo kopia
  oryginału może zniknąć bez ostrzeżenia.

## Co nie jest podatnością

- **Sam fakt, że aplikacja modyfikuje pliki klienta Tibii.** To jej zadeklarowane
  działanie, opisane w README, wykonywane wyłącznie po kliknięciu użytkownika.
- **Ostrzeżenie SmartScreen przy uruchomieniu.** Pliki nie są podpisane certyfikatem
  wydawcy; sposoby weryfikacji pobranego pliku opisuje README.
- **Zachowanie własnych źródeł wyszukiwania**, które użytkownik sam zdefiniował.
  Aplikacja wymusza na nich `https` i limity, ale za wybór serwisu odpowiada użytkownik.
- **Koszty i limity u zewnętrznego dostawcy generowania dźwięku.** Klucz i rozliczenia
  należą do użytkownika.

## Wersje

Poprawki trafiają do najnowszego wydania. Starszych wersji nie utrzymuję,
zawsze aktualizuj do najnowszej z [Releases](https://github.com/Mysttic/tibia-sounds-config/releases).

---

## In English

Please do not open a public issue for a security problem. Use
**[private vulnerability reporting](https://github.com/Mysttic/tibia-sounds-config/security/advisories/new)**
(*Security* → *Report a vulnerability*) instead.

This is a one-person hobby project: no response-time guarantees and no bounty. What
I do promise is to read the report, reply, and, if the issue is real, describe it
honestly in the changelog.

Most relevant areas: path traversal outside the client's `sounds` directory, the
`tsound://` protocol barrier, API-key storage, the network layer (https-only, size
and time limits), renderer isolation, and any scenario causing silent loss of a user's
replacements or original backups.

Not vulnerabilities: the application modifying Tibia client files (its stated purpose,
always user-initiated), the SmartScreen warning on unsigned builds, the behaviour of
search sources the user defined themselves, and third-party API costs or quotas.
