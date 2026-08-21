# Changelog

Format wg [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
wersjonowanie wg [SemVer](https://semver.org/lang/pl/).

Wersja w [`VERSION.md`](VERSION.md) jest zrodlem prawdy dla wydan &mdash; workflow release'owy
publikuje tag `v<wersja>` po merge do `master`, o ile taki tag jeszcze nie istnieje.

## [Unreleased]

## [1.6.1] - 2026-08-21

Wydanie porzadkowe przed upublicznieniem repozytorium. Kod aplikacji dziala tak samo,
zmienily sie teksty i dokumentacja.

### Zmienione

- **README skrocony z 242 do 104 linii i uzupelniony o zrzuty ekranu.** Dwanascie pytan
  FAQ, sekcja "co robi a czego nie robi" oraz opis weryfikacji pobranego pliku
  przeniesione do nowego `docs/FAQ.md`. Nic nie zniknelo, przestalo tylko blokowac
  pierwszy ekran.
- Usuniete myslniki z calej dokumentacji, z tekstow widocznych w aplikacji
  i z szablonu opisu wydania. Bannery, podpowiedzi w oknie podmiany i etykieta
  wybranego klienta brzmia inaczej, choc znacza to samo.
- `SECURITY.md` z opisem, jak zglaszac problemy bezpieczenstwa prywatnie.

### Uwaga o historii repozytorium

Repozytorium wystartowalo z czysta historia w chwili upublicznienia, dlatego widac
w nim jeden commit poczatkowy zamiast rozwoju wersji od 1.0.0. Przebieg prac opisuja
sekcje ponizej. Wydania starsze niz 1.6.1 nie maja juz stron na GitHubie.

## [1.6.0] - 2026-08-17

### Dodane

- **Zestawy dzwiekow (presety).** Jednym klikni&#281;ciem wyciszysz cala muzyke, zostawisz
  tylko odglosy walki albo tylko powiadomienia. Zestaw to **reguly, nie pliki**: mowi,
  co ma byc wyciszone, co zostawione oryginalne, a co podmienione na dzwiek z Twojej
  biblioteki. Wazy kilkaset bajtow i nie zawiera audio.
- Piec zestawow wbudowanych: *Wszystko oryginalne*, *Bez muzyki*, *Bez odglosow otoczenia*,
  *Cicho, tylko walka*, *Tylko powiadomienia*.
- **Wlasne zestawy** &mdash; przycisk *Zapisz obecny uklad* zamienia biezacy stan katalogu
  w reguly. Leza w `presets.json`, mozna je nazywac i usuwac. Wbudowanych nie da sie zmienic.
- Przed zastosowaniem aplikacja pokazuje w wierszu, co dokladnie zrobi (ile wyciszy,
  ile przywroci, ile zostawi bez zmian) i czeka na potwierdzenie &mdash; zestaw nadpisuje
  biezacy stan, wiec nie robi tego po cichu.

Zasada rozstrzygania: **ostatnia pasujaca regula wygrywa**. Bez tego nie dalo by sie
zwiezle zapisac "wycisz wszystko oprocz broni". Dzwieki, ktorych nie dotyka zadna regula,
zostaja nietkniete &mdash; dlatego *Bez muzyki* nie rusza pozostalych podmianek.

Zmierzone na realnym banku klienta 15.32 (844 dzwieki):

| operacja | dzwiekow | czas |
|---|---|---|
| *Cicho, tylko walka* | 600 wyciszen | 14,9 s |
| *Wszystko oryginalne* | 600 przywrocen | 8,4 s |
| *Bez muzyki* | 25 wyciszen | 0,8 s |
| ponowny plan tego samego zestawu | 0 do zmiany | 1 ms |

### Zmienione

- Wyciszanie partii nie wola juz ffmpega raz na dzwiek. Cisza o danych parametrach jest
  zawsze identyczna, wiec powstaje **raz na kombinacje `sampleRate` i liczby kanalow**
  i jest wspoldzielona. Na 600 wyciszonych dzwiekow powstaja **dwa** pliki ciszy zamiast
  600, bo tyle jest w banku roznych kombinacji.
- Profil przy wgrywaniu zestawu zapisywany jest zbiorczo, a nie po kazdym pliku.
  Blad na jednym dzwieku nie przerywa partii &mdash; trafia na liste pominietych.
- Wpis profilu zapamietuje `libraryId`, jesli dzwiek pochodzi z biblioteki. Dzieki temu
  zestaw potrafi odtworzyc uklad i rozpoznac, ze nic sie nie zmienilo.
- `resetSound` korzysta z wydzielonego `restoreOriginalFile`, ktory nie dotyka profilu
  &mdash; potrzebne, zeby partia zapisywala profil raz, a nie kilkaset razy.

### Bezpieczenstwo

- **Sprawdzenie, czy gra jest zamknieta, powtarza sie w trakcie wgrywania zestawu**,
  a nie tylko przed nim. Przy kilkuset plikach operacja trwa kilkanascie sekund, wiec
  gra moglaby wstac w polowie. Gdy tak sie stanie, partia jest przerywana, a to,
  co juz zrobione, zostaje zapisane i zaraportowane.

### Dla programistow

- Nowy modul `electron/lib/presets.js` (model regul, zestawy wbudowane, zapis wlasnych)
  oraz `applyPreset` w `electron/lib/profile.js`.
- 19 nowych testow, lacznie 189. Partia jest testowana na syntetycznym kliencie
  z prawdziwym ffmpegiem &mdash; w tym to, ze plikow ciszy jest tyle, ile kombinacji
  parametrow, a nie tyle, ile dzwiekow.

## [1.5.0] - 2026-08-16

Trzy rzeczy: nowa kolorystyka z trybem jasnym, generowanie dzwiekow z opisu
i biblioteka wlasnych dzwiekow.

### Dodane

- **Generowanie dzwieku z opisu.** W oknie podmiany doszla zakladka *Wygeneruj*:
  wpisujesz po angielsku, czego chcesz, i dostajesz gotowy plik. Dwa wbudowane
  zrodla &mdash; **ElevenLabs** (efekty dzwiekowe, do 30 s, z opcja zapetlenia)
  i **OpenRouter** (mowa, do zapowiedzi raidow i komunikatow). Wygenerowany plik
  przechodzi ta sama sciezke co plik z dysku: kopia oryginalu, konwersja ffmpegiem
  z zachowaniem `sampleRate` i liczby kanalow oryginalu, zapis atomowy.
- Funkcja jest **domyslnie nieaktywna** i wymaga wlasnego klucza API uzytkownika.
  Aplikacja nie ma zadnego wbudowanego klucza i za nic nie placi.
- **Biblioteka wlasnych dzwiekow** (zakladka *Moje dzwieki*). Trafia tu wszystko,
  co sam wniosles: dzwieki wygenerowane (oznaczone `AI`) i pliki wskazane z dysku
  (oznaczone `z dysku`). Kazdy mozna odsluchac, nazwac po swojemu, uzyc pod dowolny
  wpis i uzyc ponownie pod kolejny &mdash; bez placenia drugi raz za to samo
  i bez szukania pliku po dysku. Biblioteka jest niezalezna od klienta: przezywa
  aktualizacje Tibii i wskazanie innej instalacji.
- **Tryb jasny** i przelacznik wygladu w menu &mdash; jeden wiersz *Wyglad* z opcjami
  *Auto* (domyslnie, podaza za Windowsem), *Jasny* i *Ciemny*. Zmiana dziala
  natychmiast i nie zamyka menu, wiec warianty da sie porownac jednym klikni&#281;ciem.
  Wybor zostaje w `settings.json`, a motyw jest ustawiany jeszcze przed otwarciem
  okna, wiec start nie mruga drugim kolorem.

### Zmienione

- **Nowa kolorystyka.** Arkusz stylow stoi na tokenach semantycznych, a nie surowych
  kolorach: hierarchie buduja poziomy powierzchni zamiast kresek wokol wszystkiego,
  przyciski stracily ramki, promien zaokraglen wzrosl z 3 do 6&ndash;12 px, a akcent
  zostal zarezerwowany dla tego, co interaktywne albo aktywne. Wczesniej ten sam
  zloty kolor mial naglowek, numer wersji, sortowanie i aktywny przycisk naraz.
  Tlo zostalo odsycone z mocno brazowego `#14100c` do niemal neutralnego `#111010`.
- **Okno podmiany rozbite na zakladki**: *Moje dzwieki*, *Wygeneruj*, *Znajdz w sieci*,
  *Z dysku*. Wczesniej cztery zrodla staly jedno pod drugim i okno zajmowalo cala
  wysokosc ekranu. Teraz widac jedno zrodlo na raz.
- **Nazwane akcje sortuja sie przed wygenerowanymi etykietami.** 406 z 844 wpisow
  nie ma prawdziwej nazwy, tylko etykiete typu `ambience_stream #2651` &mdash; przy
  sortowaniu po nazwie zajmowaly caly pierwszy ekran. Katalog niesie teraz flage
  `named` i takie wpisy ida na koniec.
- Wskazanie pliku z dysku (takze przeciagniecie na wiersz) odklada jego kopie
  w bibliotece, zeby dalo sie go uzyc ponownie. Pliki ponad 25 MB i nie-audio
  sa pomijane &mdash; sama podmiana dziala jak dotad.
- Warstwa sieciowa obsluguje `POST` z trescia i naglowkami; tresc bledu od dostawcy
  jest przekazywana do uzytkownika, bo to zwykle jedyna informacja, dlaczego odmowil.
- Doprecyzowany opis bezpieczenstwa wyszukiwania w sieci z wydania 1.3.0
  w `docs/JAK_TO_DZIALA.md`: adres wyniku dociera do okna razem z wynikiem, natomiast
  okno nie ma dostepu do sieci i nie moze z niego skorzystac.

### Bezpieczenstwo

- **Klucz API nigdy nie lezy jawnie.** Szyfruje go `safeStorage` systemu (na Windows
  opiera sie o DPAPI, czyli klucz konta uzytkownika). Gdy szyfrowanie jest niedostepne,
  aplikacja **odmawia zapisu** zamiast zapisac klucz jawnym tekstem. Klucz nie opuszcza
  procesu glownego &mdash; okno moze co najwyzej zapytac, *czy* jest ustawiony.
  Plik `secrets.json` jest osobny od jawnego `settings.json`.
- Wpisy biblioteki sa dostepne przez `tsound://library/<id>`, gdzie sciezke wylicza
  wylacznie biblioteka na podstawie wlasnego spisu &mdash; adres nie moze wskazac pliku
  spoza niej. Pokryte testami prob podstawienia sciezki zamiast identyfikatora.
- Kolor tla okna podaza za motywem systemowym, zeby przy starcie nie mrugalo drugim
  kolorem, zanim renderer zdazy sie narysowac.

### Dla programistow

- Nowe moduly: `electron/lib/generate.js` (adaptery generatorow, wzorowane na
  `providers.js`), `electron/lib/secrets.js` (klucze przez `safeStorage`)
  i `electron/lib/library.js` (biblioteka wlasnych dzwiekow).
- 32 nowe testy jednostkowe; lacznie 170.

## [1.4.0] - 2026-08-16

Wydanie o odchudzeniu interfejsu i o bledach, ktore mogly kosztowac utrate profilu.

### Zmienione

- **Interfejs pokazuje dzwieki, a nie stan programu.** Z tabeli znikly kolumny
  *Ref*, *Plik*, *Rozmiar* i *Id*, z paska plakietki *ffmpeg*, *nazwy z client.exe*
  i *klient 15.32*, checkbox *tylko streamy*, przyciski *Odswiez*, *Dopasuj kolumny*,
  *auto*, *stop*, *Eksport profilu*, *Import profilu* i *Vault*. Zostaly cztery kolumny
  (Dzwiek w grze, Kategoria, Dlugosc, Akcje) i szesc kontrolek w naglowku zamiast
  dwudziestu. Powod: wszystkie usuniete elementy opisywaly stan wewnetrzny programu,
  a nie dzwieki w grze &mdash; np. filtr *tylko streamy* dawal dokladnie te same
  220 pozycji co kategorie MUSIC + AMBIENCE_STREAM + AMBIENCE_OBJECT, a *Rozmiar*
  korelowal z *Dlugoscia* na poziomie r = 0,99.
- **Przyciski w wierszu renderuja sie tylko wtedy, gdy cos robia.** Bylo 5064 kontrolek,
  z czego 843 wyszarzonych *Przywroc* i 844 nieaktywne *A/B* na swiezej instalacji.
  Jest 1690 kontrolek i ani jednej martwej. Wyciszenie przenioslo sie do okna podmiany
  (to i tak ta sama operacja), a *pokaz w Eksploratorze* i *kopiuj id* pod prawy przycisk myszy.
- **Status jako kropka przy nazwie zamiast osobnej kolumny** &mdash; 843 z 844 wierszy
  pokazywalo to samo slowo, wiec znaczenie ma wylacznie odstepstwo od oryginalu.
  Liczniki statusow nad lista sa jednoczesnie filtrami.
- **Stany wyjatkowe jako pasy nad lista, nie plakietki w naglowku.** Brak ffmpega,
  nazwy z zapisanej listy i nadpisanie plikow przez launcher pojawiaja sie tylko wtedy,
  gdy faktycznie zachodza, razem z przyciskiem, ktory je zalatwia. Plakietka informowala,
  gdy wszystko dziala, i milczala, gdy przestawalo.
- Sciezka klienta, przycisk *Zmien...* i wersja klienta scalone w jeden przycisk-kontekst;
  rzadkie akcje przeniesione do menu. Odswiezanie dzieje sie samo po powrocie do okna
  (oraz na <kbd>F5</kbd>), bo to jedyny moment, w ktorym statusy moga byc nieaktualne.
- Kolumny techniczne (*Ref*, *Id*, *Plik*, *Rozmiar*) wracaja jednym klikni&#281;ciem
  przez *Pokaz szczegoly techniczne* w menu &mdash; nie zostaly usuniete, tylko schowane.
- Suma minimalnych szerokosci kolumn spadla z 904 do 532 px, wiec `MIN_WINDOW_WIDTH`
  zszedl z 940 na 580 &mdash; okno miesci sie na polowie znacznie wezszego ekranu.
- Wyszukiwarka przeszukuje nazwe akcji, kategorie, id i zrodlo podmianki. Referencja
  i nazwa pliku wypadly razem ze swoimi kolumnami, zeby wyniki nie trafialy w wiersze,
  w ktorych szukanego tekstu nie widac.
- Komunikaty z procesu glownego docieraja do uzytkownika bez opakowania Electrona
  (`Error invoking remote method 'sound:replace': Error: ...`), odmieniaja sie przez
  liczebnik i mowia nazwa dzwieku zamiast `#677`.
- Widac, ze aplikacja pracuje: pasek pod naglowkiem (z realnym postepem przy liczeniu
  odciskow), kursor oczekiwania i podswietlenie zmienionego wiersza.
- Doprecyzowany opis bezpieczenstwa wyszukiwania w sieci z wydania 1.3.0. Poprzednie
  sformulowanie mowilo, ze okno aplikacji nie ma dostepu "do adresow"; w rzeczywistosci
  adres wyniku dociera do okna razem z wynikiem wyszukiwania &mdash; okno nie ma
  natomiast dostepu do sieci i nie moze z niego skorzystac.

### Naprawione

- **Profil zapisywany nieatomowo.** Przerwany zapis (zamkniecie okna, brak miejsca)
  zostawial uciety JSON, po ktorym wszystkie podmianki stawaly sie "obce". Teraz
  tmp + rename, tak jak przy plikach dzwiekowych.
- **Brak blokady drugiej instancji.** Dwie kopie aplikacji wskazujace tego samego
  klienta trzymaly wlasny profil w pamieci i przy zapisie kasowaly sobie nawzajem
  podmianki. Druga instancja wyciaga teraz na wierzch okno pierwszej.
- **Eksport, import i ponowne wgranie podmianek bez wybranego klienta** konczyly sie
  surowym `Cannot read properties of null` &mdash; w dodatku dopiero po przejsciu przez
  okno wyboru pliku. Teraz odmawiaja od razu i po ludzku.
- **Nieudane wczytanie klienta zostawialo pomieszany stan** &mdash; `state.client`
  wskazywal nowa instalacje, a katalog opisywal poprzednia. Calosc powstaje teraz
  w zmiennych lokalnych i trafia do stanu jednym podstawieniem.
- **Wykrywanie uruchomionego klienta bylo fail-open**: blad `tasklist` (np. przekroczony
  limit czasu) byl cicho traktowany jak "gra nie dziala" i przepuszczal zapis przy
  wlaczonej Tibii. Wynik jest teraz trojstanowy, a nieudane sprawdzenie wstrzymuje zapis.
- **ffmpeg wykrywany tylko przy starcie** &mdash; kto zainstalowal go pozniej, do konca
  sesji widzial komunikat o jego braku. Doszedl przycisk *Sprawdz ponownie*.
- **Pamiec podgladow z sieci rosla bez ograniczen** i kazdy kiedykolwiek znaleziony
  adres zostawal pobieralny do konca zycia procesu. Teraz limit 200 najswiezszych.
- Zapisy `settings.json` sa szeregowane i atomowe &mdash; rownolegly zapis geometrii
  okna i sciezki klienta gubil jedna ze zmian.
- Okno pamieta rozmiar i polozenie (z walidacja wzgledem podlaczonych ekranow),
  glosnosc odsluchu przezywa restart, a nieudane wczytanie dzwieku nie zostawia
  wiersza zapalonego na stale.

### Bezpieczenstwo

- Rozstrzyganie adresow `tsound://` wydzielone z `main.js` do `electron/lib/tsound.js`
  jako czysta funkcja. To jedyna bariera miedzy nazwa przyslana przez okno aplikacji
  a odczytem pliku z dysku, a w procesie glownym nie dalo sie jej przetestowac bez
  uruchamiania calego Electrona. Doszly testy prob wyjscia poza katalog, takze
  zakodowanych procentowo.
- Testy warstwy sieciowej: odrzucanie adresow innych niz `https`, przerwanie pobierania
  po przekroczeniu limitu mimo klamliwego `Content-Length`, sprzatanie katalogu
  tymczasowego po bledzie.
- `setWindowOpenHandler` i blokada `will-navigate` &mdash; okno nie ma linkow ani
  nawigacji, wiec kazda taka proba oznacza, ze cos poszlo nie tak.

### Dla programistow

- Kolumny sa definiowane w `renderer/app.js`, a komorki maja `data-col`. Skrypty w `tools/`
  czytaly je po indeksie i po cichu sypaly sie przy kazdej zmianie ukladu; teraz czytaja
  po nazwie i steruja aplikacja przez `window.__tsc` zamiast klikac po identyfikatorach.
  `tools/e2e-columns.js` mial wlasna, recznie przepisana kopie mapy minimow &mdash;
  bierze ja teraz z jednego zrodla.
- 34 nowe testy jednostkowe (`tests/tsound.test.js`, `tests/net.test.js`,
  `tests/processes.test.js`); lacznie 138.

## [1.3.0] - 2026-08-16

### Dodane

- **Wyszukiwanie dzwiekow w sieci.** Przycisk *Podmien* otwiera okno, w ktorym mozna
  wpisac fraze (np. "big explosion"), odsluchac wyniki i jednym klikni&#281;ciem podmienic
  dzwiek w kliencie. Ponowny klik w &#9654; zatrzymuje odsluch. Pobrany plik przechodzi
  ta sama sciezke co plik z dysku: kopia oryginalu, konwersja ffmpegiem, zapis atomowy.
- Dwa wbudowane zrodla, oba bez rejestracji i klucza API: **Openverse** (agregator
  wolnych tresci, m.in. Freesound) i **Internet Archive**. Wyniki sa filtrowane twardo
  do licencji CC0; Internet Archive dodatkowo ograniczony do kolekcji, ktore w calosci
  sa CC0.
- Wlasne zrodla uzytkownika &mdash; deklaratywne adaptery JSON (`searchUrl`, `resultsPath`,
  mapowanie pol). Za ich zgodnosc z regulaminem i licencjami odpowiada uzytkownik.
- Wklejanie bezposredniego linku do pliku audio.
- Pochodzenie pobranego dzwieku (autor, licencja, adres zrodla) zapisywane w profilu.
- **Import profilu.** Eksport zapisuje podmianki **razem z dzwiekami** w jednym pliku
  JSON, a import wgrywa je z powrotem. Rozwiazuje sytuacje, w ktorej po aktualizacji
  albo przeinstalowaniu klienta pliki wracaja do oryginalu: wczytujesz profil
  i podmianki sa z powrotem, razem z informacja o pochodzeniu i licencji. Import nie
  wymaga ffmpega &mdash; audio w profilu jest juz w formacie gry.
- Dzwieki, ktorych nie ma w biezacej wersji klienta (bo CipSoft je przekodowal, wiec
  zmienila sie nazwa pliku), sa przy imporcie pomijane i **raportowane**, a nie po
  cichu gubione. Tak samo wpisy z uszkodzonym audio &mdash; sprawdzane przed
  nadpisaniem czegokolwiek.

### Bezpieczenstwo

- Caly ruch sieciowy wychodzi wylacznie z procesu glownego i tylko na zadanie uzytkownika.
  Okno aplikacji nie ma dostepu do sieci &mdash; odsluch wyniku dostaje przez klucz
  i protokol `tsound://`, wiec CSP pozostaje szczelne.
- Dozwolone jest wylacznie `https`; adresy `http`, `file` i `data` sa odrzucane.
  Prefiks URL we wlasnych zrodlach doklejany jest tylko do sciezek wzglednych, zeby
  absolutny adres `http://` nie mogl sie skleic w pozornie poprawny `https`.
- Limit 25 MB na pobierany plik, przerywany w trakcie pobierania.

### Zmienione

- README i `docs/JAK_TO_DZIALA.md`: opisany mechanizm laczenia sie z siecia,
  lista odpytywanych adresow i zabezpieczen. Poprzednie zdanie o braku jakichkolwiek
  polaczen przestalo byc prawdziwe i zostalo zastapione konkretem.

## [1.2.0] - 2026-08-14

Wydanie o dystrybucji: nic nie zmienia sie w dzialaniu aplikacji, chodzi o to,
zeby dalo sie sprawdzic, co sie pobralo.

### Dodane

- Trzeci wariant do pobrania: archiwum `.zip` z ta sama aplikacja co wersja portable.
  Przegladarki traktuja archiwa lagodniej niz surowe pliki `.exe`, wiec jest to
  wyjscie awaryjne, gdy pobieranie instalatora jest blokowane.
- Poswiadczenie pochodzenia buildu (`actions/attest-build-provenance`) &mdash;
  kryptograficzny dowod, ze dany plik powstal z konkretnego commita w tym repozytorium
  na serwerach GitHuba. Weryfikacja: `gh attestation verify <plik> --repo <repo>`.
  GitHub udostepnia te funkcje tylko dla repozytoriow publicznych, wiec krok
  wlacza sie automatycznie dopiero po zmianie widocznosci repozytorium.
- Sumy SHA-256 wszystkich artefaktow w opisie kazdego wydania, razem z instrukcja
  sprawdzenia (`Get-FileHash`).

### Zmienione

- README: sekcja instalacji rozbita na trzy warianty pobrania i osobny akapit
  o ostrzezeniu SmartScreen wraz z trzema sposobami weryfikacji pliku.

## [1.1.0] - 2026-08-14

### Dodane

- Okno startuje na polowie obszaru roboczego ekranu (nie mniej niz 940 px, czyli tyle,
  ile potrzeba na tabele bez przewijania w poziomie).
- Dopasowanie szerokosci kolumn do okna: tryb *auto* (domyslny) reaguje na zmiane
  rozmiaru okna i filtrow, przycisk *Dopasuj kolumny* robi to jednorazowo. Kazda kolumna
  ma wlasna minimalna szerokosc, wiec przy waskim oknie nic nie zostaje sciete do zera.
- `start.bat` &mdash; uruchamianie jednym klikiem. Ten sam plik dziala obok zainstalowanej
  aplikacji (odpala `.exe`) i w katalogu zrodel (instaluje zaleznosci i robi `npm start`).
  Trafia tez do paczki instalacyjnej.

### Zmienione

- README przepisane pod uzytkownikow koncowych (co aplikacja robi z plikami,
  bezpieczenstwo, FAQ). Szczegoly dzialania przeniesione do
  `docs/JAK_TO_DZIALA.md`, tresci dla programistow do `docs/DEVELOPMENT.md`.

- Przyciski akcji w tabeli sa teraz ikonami z podpowiedziami zamiast napisow &mdash;
  kolumna zwezila sie z 296 do 206 px, dzieki czemu tabela miesci sie na polowie
  ekranu 1920 px bez przewijania w bok.
- Szerokosci kolumn mierzone sa z modelu danych zamiast przez `innerText`, wiec
  dopasowanie nie wymusza przeliczenia ukladu 844 wierszy.

### Naprawione

- Test `slugForClient` mial wpisane na sztywno sciezki windowsowe i przewracal CI
  na `ubuntu-latest` &mdash; na Linuksie backslash nie jest separatorem, wiec
  `path.basename('C:\\...')` zwraca cala sciezke zamiast ostatniego segmentu.
  Sciezki testowe skladane sa teraz przez `path.join`.

## [1.0.0] - 2026-08-13

Pierwsze wydanie.

### Dodane

- Odczyt banku dzwiekow klienta (`sounds-<sha256>.dat`, protobuf `tibia.protobuf.sound.Sounds`)
  wraz z nazwami akcji wyciaganymi z deskryptorow w `client.exe`; fallback na snapshot
  z klienta 15.32 w `data/enums.snapshot.json`.
- Tabela wszystkich dzwiekow: akcja, kategoria, referencja, id, plik, rozmiar, dlugosc,
  status; wyszukiwarka, filtr kategorii i statusu, sortowanie po kazdej kolumnie.
- Reczna zmiana szerokosci kolumn przeciaganiem granicy naglowka, dwuklik na granicy
  dopasowuje kolumne do najdluzszej tresci. Ustawienia zostaja w `localStorage`.
- Odtwarzanie dzwieku z klienta i porownanie A/B z oryginalem z vaulta
  (protokol `tsound://`, walidacja nazw plikow).
- Podmiana dzwieku na wlasny plik (mp3/wav/flac/m4a/ogg/opus/aac/wma) z konwersja przez
  ffmpeg do Vorbis, z zachowaniem `sampleRate` i liczby kanalow oryginalu.
  Obsluga drag&drop pliku prosto na wiersz tabeli.
- Wyciszanie pojedynczego dzwieku (0,05 s ciszy o parametrach oryginalu).
- Przywracanie oryginalu z vaulta lub z recznej kopii `___sound-<sha256>.ogg`.
- Wykrywanie stanu plikow po sha256: `oryginal`, `podmieniony`,
  `nadpisany przez launcher`, `obcy`, `brak pliku`.
- Przycisk *Zastosuj ponownie* &mdash; wgrywa podmianki z powrotem po patchu launchera.
- Eksport profilu do JSON.
- Blokada zapisu gdy klient Tibii jest uruchomiony.
- Cache hashy po `size` + `mtime` &mdash; ponowne wczytanie 844 plikow (110 MB) w ~0,3 s.
- Instalatory Windows: NSIS i portable.
- `VERSION.md` jako zrodlo prawdy dla numeru wersji; numer widoczny na pasku
  aplikacji i w tytule okna.

### Bezpieczenstwo

- `contextIsolation: true`, `nodeIntegration: false`, CSP w rendererze;
  caly dostep do dysku przez `contextBridge`.
- Zapis wylacznie do `<klient>/packages/Tibia/sounds/*.ogg` i wlasnego vaulta;
  nazwy plikow walidowane wzorcem `sound-<64 hex>.ogg`, wiec nie da sie wyjsc
  poza katalog dzwiekow.

[Unreleased]: https://github.com/Mysttic/tibia-sounds-config/compare/v1.6.1...HEAD
[1.6.1]: https://github.com/Mysttic/tibia-sounds-config/releases/tag/v1.6.1

Wersje starsze niz 1.6.1 nie maja odsylaczy, bo powstaly przed rozpoczeciem historii
repozytorium od nowa. Ich opisy zostaja powyzej jako zapis tego, co i kiedy sie zmienilo.
