# Tibia Sounds Config

Przegladaj i podmieniaj dzwieki klienta Tibii. Kazdy z ~844 plikow ma tu czytelna nazwe
akcji z gry, wiec wiesz, co wlasciwie zmieniasz.

![Lista dzwiekow z wyszukiwarka](docs/img/lista.png)

- **Odsluchaj** dowolny dzwiek bez wchodzenia do gry.
- **Podmien** na wlasny plik (mp3, wav, flac, m4a&hellip;), **wycisz** albo **przywroc oryginal**.
  Aplikacja zawsze trzyma kopie zapasowa.
- **Znajdz w sieci**: wpisujesz "big explosion", sluchasz wynikow, podmieniasz.
  Wbudowane zrodla daja wylacznie pliki na licencji CC0.
- **Wygeneruj z opisu**: "deep dragon roar with echo". Opcjonalne, wymaga Twojego
  klucza API; domyslnie wylaczone.
- **Zestawy dzwiekow**: jednym klikiem wyciszasz cala muzyke albo zostawiasz tylko
  odglosy walki. Wlasne uklady zapisujesz pod nazwa.

Wszystko, czego uzyjesz, czyli dzwieki wygenerowane i pliki wskazane z dysku, zostaje
w bibliotece, wiec tego samego dzwieku uzyjesz pod kolejny wpis bez szukania go po dysku.

![Okno podmiany z czterema zrodlami](docs/img/podmiana.png)

> **Zanim uzyjesz.** To zmiana czysto kosmetyczna: slychac co innego, a gra dziala
> tak samo. Klient Tibii jest wspierany przez CipSoft wylacznie w stanie oryginalnym,
> wiec kazda modyfikacja jego plikow odbywa sie na Twoja odpowiedzialnosc. Powrot jest
> zawsze mozliwy: przyciskiem w aplikacji albo weryfikacja plikow w launcherze Tibii.

## Instalacja

Pobierz z [Releases](https://github.com/Mysttic/tibia-sounds-config/releases):

| plik | dla kogo |
|---|---|
| `...-setup.exe` | instalator: skrot na pulpicie i w menu Start |
| `...-portable.exe` | jeden plik, bez instalacji, dziala z pendrive'a |
| `...-win-x64.zip` | to samo co portable, w archiwum, gdy przegladarka utrudnia pobranie `.exe` |

Do podmiany i wyciszania potrzebny jest jeszcze darmowy
[ffmpeg](https://ffmpeg.org/download.html). Bez niego dziala przegladanie i odsluch.

Windows pokaze *"Windows protected your PC"*, czyli **More info** &rarr; **Run anyway**.
Pliki nie sa podpisane certyfikatem wydawcy; jak sprawdzic, co pobrales, opisuje
[FAQ](docs/FAQ.md#instalacja).

## Jak uzywac

1. Aplikacja sama znajduje klienta w `%LOCALAPPDATA%\Tibia`. Przycisk na gornym pasku
   pokazuje, z ktorej instalacji korzystasz, a klikniecie wskazuje inna.
2. Szukaj po nazwie akcji, kategorii albo id, np. `raid`. Klawisz <kbd>/</kbd>
   przenosi kursor do wyszukiwarki.
3. **&#9654;** odtwarza, drugie klikni&#281;cie (albo <kbd>Esc</kbd>) zatrzymuje.
4. **Podmien** otwiera okno z czterema zrodlami. Plik mozna te&#380; przeciagnac prosto
   na wiersz, bez otwierania okna.
5. Prawy przycisk myszy na wierszu otwiera reszte akcji: pokazanie pliku w Eksploratorze,
   skopiowanie id.

Kropka przy nazwie oznacza dzwiek, ktory nie jest juz oryginalem. Liczniki nad lista sa
jednoczesnie filtrami. Przed kazda zmiana aplikacja sprawdza, czy Tibia jest uruchomiona,
i odmawia zapisu, jesli tak.

**Po aktualizacji Tibii** launcher przywraca oryginalne dzwieki. To normalne.
Aplikacja to wykrywa i pokazuje pasek *&bdquo;Tibia przywrocila N Twoich dzwiekow&rdquo;*
z przyciskiem **Przywroc moje**.

## Wiecej

| | |
|---|---|
| pytania i watpliwosci (bany, kopie, licencje, siec) | [docs/FAQ.md](docs/FAQ.md) |
| co dokladnie dzieje sie z plikami | [docs/JAK_TO_DZIALA.md](docs/JAK_TO_DZIALA.md) |
| uruchomienie ze zrodel, wlasny build | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| format danych klienta Tibii | [docs/SOUND_FORMAT.md](docs/SOUND_FORMAT.md) |
| historia zmian | [CHANGELOG.md](CHANGELOG.md) |
| zglaszanie problemow bezpieczenstwa | [SECURITY.md](SECURITY.md) |

## Zastrzezenie

Nieoficjalny projekt fanowski. **Nie jest zwiazany z CipSoft GmbH ani przez nikogo
z ramienia CipSoftu zatwierdzony.** Klient Tibii jest dostarczany i wspierany przez
CipSoft wylacznie w stanie oryginalnym. Kazda modyfikacja jego plikow odbywa sie
**wylacznie na Twoja odpowiedzialnosc**; autor nie ponosi odpowiedzialnosci za problemy
techniczne ani nastepstwa korzystania z projektu.

[MIT](LICENSE). Tibia jest znakiem towarowym CipSoft GmbH; ten projekt **nie zawiera
zadnych plikow gry**, pracuje na dzwiekach z Twojej wlasnej instalacji.

---

## In English

Browse and replace the Tibia client's sound files. Each of the ~844 files is labelled
with the in-game action it belongs to, so you can see what you are changing.

This replaces selected `.ogg` files with alternative audio of the same name and format.
It is a purely cosmetic modification: it does not modify the client executable, `.dat`
files or asset catalogs, does not inject code or hook the game process, does not alter
gameplay or the information available to the player, and provides no advantage over other
players. Replacement audio is re-encoded to the original file's sample rate and channel
count, and a backup of every original is kept before the first replacement.

Unofficial fan project, **not affiliated with or endorsed by CipSoft GmbH**. The Tibia
client is supported by CipSoft only in its original, unmodified state, so any modification
of client files is done **entirely at your own risk**. The author takes no responsibility
for technical issues or any consequences of using this project.
