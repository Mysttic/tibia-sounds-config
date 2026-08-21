# Najczestsze pytania

## O grze i bezpieczenstwie

**Czy podmiana daje jakies ulatwienie w grze?**
Nie. Zmienia sie wylacznie to, co slychac. Aplikacja nie dotyka plikow, ktore decyduja
o zachowaniu gry, nie wstrzykuje kodu, nie czyta pamieci procesu i nie zmienia zadnych
informacji dostepnych graczowi. Dzwiek trwajacy inaczej niz oryginal nie przyspiesza
ani nie opoznia niczego w grze, jest tylko dzwiekiem. Rozwiniecie:
[Dlaczego to nie wplywa na gre](JAK_TO_DZIALA.md#dlaczego-to-nie-wplywa-na-gre).

**Czy to moze zepsuc klienta?**
Aplikacja pisze wylacznie do plikow `.ogg` w katalogu `sounds/` i przekodowuje kazdy
plik do formatu oryginalu (ta sama czestotliwosc probkowania i liczba kanalow), wiec
silnik dostaje dokladnie to, czego oczekuje. Nie rusza plikow wykonywalnych ani danych
gry. Gdyby cokolwiek poszlo nie tak, sa dwie drogi powrotu: przycisk **Przywroc**
w aplikacji albo uruchomienie launchera Tibii, ktorego weryfikacja plikow przywraca
klienta w 100% do stanu fabrycznego.

**Czy moge dostac za to bana?**
Nikt uczciwie nie da Ci gwarancji, ani ja, ani nikt inny poza CipSoftem. To, co
mozna powiedziec rzetelnie: projekt jest swiadomie zaprojektowany tak, zeby nie robic
niczego poza podmiana warstwy dzwiekowej, i nie daje zadnej przewagi nad innymi graczami.
CipSoft wspiera klienta wylacznie w stanie oryginalnym i kazda modyfikacja plikow,
takze czysto kosmetyczna, odbywa sie na Twoja odpowiedzialnosc. Jesli masz
watpliwosci, graj na kliencie w stanie oryginalnym.

**Czy inni gracze uslysza moje dzwieki?**
Nie. Zmiany sa wylacznie na Twoim komputerze.

**Czego aplikacja na pewno nie robi?**
Nie modyfikuje pliku wykonywalnego klienta, plikow `.dat` ani katalogow zasobow
(`assets.json`). Nie wstrzykuje kodu, nie podpina sie do procesu gry i nie czyta jej
pamieci. Nie wysyla o Tobie zadnych danych: zero telemetrii, zero konta. Nie dziala
w tle: pliki gry zmienia wylacznie po Twoim klikni&#281;ciu. Pelna lista miejsc, w ktorych
cokolwiek zapisuje, jest w [JAK_TO_DZIALA.md](JAK_TO_DZIALA.md#miejsca-w-ktorych-aplikacja-cokolwiek-zapisuje).

## Kopie i odzyskiwanie

**Gdzie sa kopie oryginalow?**
W `%APPDATA%\Tibia Sounds Config\vault`, osobno dla kazdej instalacji klienta.
Szczegoly w [JAK_TO_DZIALA.md](JAK_TO_DZIALA.md#kopie-bezpieczenstwa-vault).

**Zmienilem wersje klienta i podmianki zniknely. Da sie je odzyskac?**
Tak. Jesli aplikacja wykryla, ze launcher nadpisal pliki, sama zaproponuje nad lista
**Przywroc moje**. A jesli przeinstalowales klienta albo przenosisz sie na inny komputer,
to w menu (przycisk **&#8943;** w prawym gornym rogu) znajdziesz
**Zapisz kopie moich podmianek** (zapisuje je *razem z dzwiekami* do jednego pliku)
oraz **Wczytaj kopie** na nowej instalacji. Dzwieki, ktore w nowej wersji klienta juz
nie istnieja, zostana pominiete i wypisane.

**Jak calkowicie usunac wszystkie zmiany?**
Kliknij **Przywroc** przy podmienionych dzwiekach albo po prostu uruchom launcher
Tibii, ktorego weryfikacja plikow przywraca klienta w 100% do stanu fabrycznego.

## Interfejs

**Gdzie sa techniczne szczegoly: nazwa pliku, id, rozmiar?**
W menu **&#8943;** jest pozycja *Pokaz szczegoly techniczne*, ktora dokłada kolumny
z referencja, id, nazwa pliku i rozmiarem. Domyslnie sa ukryte, bo do podmiany dzwieku
nie sa potrzebne.

**Da sie zmienic wyglad na jasny?**
Tak, w menu **&#8943;** &rarr; wiersz *Wyglad*: **Auto** (domyslnie, podaza za Windowsem),
**Jasny**, **Ciemny**.

## Konta, siec, licencje

**Czy aplikacja czegos ode mnie wymaga? Konta, logowania?**
Do wszystkiego poza generowaniem nie. Zadnego konta, zadnej rejestracji, zadnej
telemetrii; wyszukiwanie dzwiekow w sieci tez dziala bez logowania. Do samego przegladania
i odsluchu internet nie jest w ogole potrzebny.

Wyjatkiem jest **generowanie dzwieku z opisu**. Ta funkcja jest domyslnie nieaktywna
i wymaga Twojego wlasnego klucza API u zewnetrznego dostawcy, bo aplikacja nie ma
wlasnego klucza i za nic nie placi. Klucz zapisujemy zaszyfrowany mechanizmem systemu
i nigdy nie opuszcza on Twojego komputera. Dopoki go nie wkleisz, nic sie nie dzieje.

**Skad pochodza dzwieki z wyszukiwarki i czy moge ich uzywac?**
Wbudowane zrodla to **Openverse** (agregator wolnych tresci, m.in. Freesound) oraz
kuratorowane kolekcje **Internet Archive**. Oba sa filtrowane wylacznie do licencji
**CC0**, czyli domeny publicznej, wiec mozesz ich uzywac bez podawania autora.
Aplikacja i tak zapisuje autora i licencje kazdego pobranego dzwieku.

Mozesz tez dodac wlasne zrodlo albo wkleic bezposredni link do pliku. Wtedy
odpowiedzialnosc za sprawdzenie licencji i regulaminu tej strony jest po Twojej stronie.

**Kiedy aplikacja laczy sie z internetem?**
Tylko gdy sam klikniesz *Szukaj*, *Wygeneruj* albo *Uzyj*. Zadnego odpytywania w tle,
sprawdzania aktualizacji ani statystyk. Lista odpytywanych adresow:
[JAK_TO_DZIALA.md](JAK_TO_DZIALA.md#kiedy-aplikacja-laczy-sie-z-internetem).

## Instalacja

**Windows pokazuje "Windows protected your PC". Co teraz?**
**More info** &rarr; **Run anyway**. Powod jest prozaiczny: certyfikat wydawcy kosztuje
kilkaset zlotych rocznie i tego projektu nie ma kto sponsorowac, a bez niego Windows
traktuje kazdy program jako "nieznanego wydawce", niezaleznie od tego, co robi.

Zamiast wierzyc na slowo mozesz **sprawdzic, co pobrales**:

- **suma kontrolna**: porownaj wynik z lista SHA-256 w opisie wydania:
  ```powershell
  Get-FileHash .\tibia-sounds-config-1.6.1-win-x64-setup.exe -Algorithm SHA256
  ```
- **pochodzenie pliku**: dowod, ze binarka powstala z konkretnego commita w tym
  repozytorium, na serwerach GitHuba, a nie na czyims komputerze
  (wymaga [GitHub CLI](https://cli.github.com/)):
  ```bash
  gh attestation verify tibia-sounds-config-1.6.1-win-x64-setup.exe --repo Mysttic/tibia-sounds-config
  ```
- **wlasny build**: caly kod jest tutaj, mozesz
  [zbudowac aplikacje samodzielnie](DEVELOPMENT.md) i nie pobierac niczego gotowego.

**Po co ffmpeg?**
Przerabia Twoje mp3 na format, ktorego oczekuje silnik gry (ta sama czestotliwosc
probkowania i liczba kanalow co oryginal). Bez niego dziala przegladanie i odsluch,
nie dziala podmiana ani wyciszanie. Aplikacja pokazuje wtedy pasek z linkiem do
instalacji i przyciskiem *Sprawdz ponownie*.
