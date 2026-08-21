# Architektura

## Procesy

```
                 proces glowny (electron/main.js)
                 - jedyny z dostepem do dysku i do ffmpega
                 - rejestruje protokol tsound://
                 - trzyma stan: client, vault, profile, catalog
                          |
                    IPC (ipcMain.handle)
                          |
                 preload (electron/preload.js)
                 - contextBridge -> window.api
                 - contextIsolation: true, nodeIntegration: false
                          |
                 renderer (renderer/app.js)
                 - tabela, filtry, odtwarzanie
                 - zero dostepu do node
```

Renderer nie widzi `require`, `fs` ani `path`. Wszystko, co dotyka dysku, przechodzi
przez nazwane kanaly IPC wypisane w `preload.js`. CSP w `renderer/index.html` dopuszcza
media tylko z `tsound:`.

## Przeplyw danych przy starcie

```
app:init
  -> detectFfmpeg()                     audio.js       czy jest ffmpeg + libvorbis
  -> readSettings()                     main.js        zapamietana sciezka klienta
  -> autodetect()                       clientPaths.js %LOCALAPPDATA%\Tibia itd.
  -> useClient(dir)
       -> validateClientDir(dir)        clientPaths.js szuka packages/Tibia/sounds/catalog-sound.json
       -> loadProfile(vault)            profile.js     vault/clients/<slug>/profile.json
       -> buildCatalog(...)             catalog.js
            -> loadSoundBank(soundsDir) soundBank.js   catalog-sound.json -> sounds-<sha256>.dat
            -> loadEnums(clientExe)     descriptors.js deskryptor z client.exe albo snapshot
            -> buildUsageMap(bank,enums)               soundId -> [{event, category, ref}]
            -> sha256 kazdego pliku (pool 8, cache po size+mtime)
            -> computeStatus(...)                      original / replaced / drifted / foreign / missing
  <- publicState()                                     leci do renderera
```

## Moduly

| plik | odpowiedzialnosc | zaleznosci |
|---|---|---|
| `electron/lib/protobuf.js` | czytnik wire formatu: varinty, pola, packed, skan prefiksu | brak |
| `electron/lib/soundBank.js` | `sounds-<sha256>.dat` -> `{sounds, numericEffects, ambienceStreams, ambienceObjectStreams, musicTemplates}` | protobuf |
| `electron/lib/descriptors.js` | `FileDescriptorProto` z `client.exe` -> enumy; fallback na `data/enums.snapshot.json` | protobuf |
| `electron/lib/clientPaths.js` | wykrywanie i walidacja instalacji klienta | brak |
| `electron/lib/audio.js` | ffmpeg (konwersja, cisza) + odczyt naglowkow ogg bez ffprobe | ffmpeg w PATH |
| `electron/lib/catalog.js` | join bank + nazwy + sha256 -> lista wpisow ze statusem, cache hashy | soundBank, descriptors, audio |
| `electron/lib/profile.js` | vault, kopie oryginalow, apply / reset / reapply | catalog, audio |
| `electron/lib/processes.js` | czy klient Tibii dziala (blokada zapisu) | brak |

Zaleznosci ida w jedna strone: `protobuf` <- `soundBank`/`descriptors` <- `catalog` <- `profile`.
Nic nie importuje `main.js`, wiec cala logika jest testowalna bez uruchamiania Electrona.

## Dlaczego wlasny parser protobuf

Bank ma piec typow komunikatow i lacznie kilkanascie pol. Pelna biblioteka protobuf
(`protobufjs`) to ~1 MB zaleznosci i generowanie kodu ze schematu, ktorego CipSoft
nie publikuje, bo i tak trzeba by go odtworzyc z deskryptora. Wlasny czytnik ma
~100 linii, nie ma zaleznosci i ignoruje nieznane pola, wiec nowsza wersja klienta
go nie wywroci (test: `tests/soundBank.test.js`).

## Skad nazwy akcji

`client.exe` jest zbudowany z pelnym protobufem, wiec w sekcji danych siedzi
serializowany `FileDescriptorProto` dla `sounds-common.proto`. `descriptors.js` szuka
sekwencji `0x0a <dlugosc> "sounds-common.proto"`, po czym parsuje blob do momentu,
w ktorym kolejne pola przestaja byc poprawne (`scanValidPrefix`), bo dlugosci blobu
nie znamy z gory.

Efekt: nazwy pochodza ze *wskazanej* instalacji, wiec nowa wersja klienta z nowymi
dzwiekami dostaje nazwy automatycznie. Gdy skan zawiedzie, wchodzi
`data/enums.snapshot.json` (klient 15.32.df7b29) i pasek gorny pokazuje "nazwy ze snapshotu".

## Statusy plikow

Nazwa `sound-<sha256>.ogg` **jest** sha256 oryginalnej tresci. Cala detekcja stanu
sprowadza sie do porownania hashy: bez wlasnego manifestu, bez pliku stanu,
odporna na to, ze ktos grzebal w plikach recznie.

| status | warunek |
|---|---|
| `original` | `sha256(plik) == hash z nazwy`, brak wpisu w profilu |
| `replaced` | hash inny niz w nazwie, zgodny z `profile.entries[id].appliedHash` |
| `drifted` | hash **zgodny** z nazwa, ale wpis w profilu istnieje &rarr; launcher nadpisal podmianke |
| `foreign` | hash inny niz w nazwie i nie pochodzi z profilu |
| `missing` | bank wymienia dzwiek, ktorego nie ma na dysku |

## Vault

```
vault/clients/<nazwa>-<sha1(sciezki)[0:10]>/
  profile.json     { version, clientRoot, entries: { "<soundId>": {...} } }
  originals/       kopie oryginalow, nazwa = sound-<sha256>.ogg
  library/         skonwertowane podmianki, <uuid>.ogg
  hashcache.json   { "<plik>": { size, mtimeMs, hash } }
```

Slug liczony ze znormalizowanej sciezki, wiec kazda instalacja ma osobny vault i profile
sie nie mieszaja. W trybie deweloperskim vault jest w repo (gitignore), w spakowanej
aplikacji w `app.getPath('userData')/vault`.

Kopie trzymamy lokalnie, bo pobranie oryginalu z CDN nie wchodzi w gre:
`https://static.tibia.com/launcher/assets-current/sounds/...` zwraca HTTP 403
(Cloudflare challenge). Drugie zrodlo oryginalu to reczny backup w konwencji
`___sound-<sha256>.ogg` lezacy obok podmianki. Rozpoznaje go `profile.js`.

## Bezpieczenstwo operacji na plikach

- kazda nazwa przechodzi przez `FILENAME_HASH` (`^sound-[0-9a-f]{64}\.ogg$`), wiec
  `../` czy dowolna inna sciezka nie przejdzie
- zapis jest atomowy: `copyFile` do `<cel>.tmp-<rand>`, potem `rename`
- przed pierwszym nadpisaniem powstaje kopia oryginalu; bez niej `applySound` odmawia
- zapis jest blokowany, gdy `client.exe` / `Tibia.exe` sa uruchomione (`processes.js`)
- `assets.json`, `package.json` klienta, `.dat` i binaria nie sa ruszane

## Protokol tsound://

```
tsound://sound/<plik.ogg>     aktualny plik z katalogu klienta
tsound://original/<plik.ogg>  kopia oryginalu z vaulta (podglad A/B)
```

Zarejestrowany jako `standard` + `secure` + `supportFetchAPI`, obsluzony przez
`protocol.handle` w `main.js`. Alternatywa (`file://` z wylaczonym `webSecurity`)
otwieralaby rendererowi caly dysk. Nazwa pliku jest walidowana tym samym wzorcem
co przy zapisie, `?v=<hash>` sluzy do omijania cache po podmianie.
