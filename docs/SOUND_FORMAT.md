# Format banku dzwiekow klienta Tibii

Opis odtworzony z klienta **15.32.df7b29** (Windows). Wszystko ponizej wynika
z deskryptorow protobuf wkompilowanych w `client.exe` i z zawartosci samych plikow,
bez zadnej dokumentacji CipSoftu.

## Uklad plikow

```
<klient>/
  packages/Tibia/
    package.json                       manifest launchera: wersja + hashe plikow programu
    assets.json                        manifest assetow: packedhash + packedsize kazdego .ogg
    assets.json.sha256
    bin/client.exe                     zawiera deskryptory protobuf (nazwy akcji)
    sounds/
      catalog-sound.json               [ { "file": "sounds-<sha256>.dat", "type": "sounds" } ]
      sounds-<sha256>.dat              bank (protobuf tibia.protobuf.sound.Sounds)
      sound-<sha256>.ogg               844 pliki Vorbis
```

**Nazwa pliku dzwieku jest sha256 jego tresci.** To sprawia, ze weryfikacja
integralnosci nie wymaga zadnych dodatkowych danych. `assets.json` powtarza ten sam
hash w polu `packedhash` i dokłada `packedsize`.

## Schematy protobuf

Odtworzone z `client.exe`, pelne wydruki: [`sounds.proto.txt`](sounds.proto.txt),
[`sounds-common.proto.txt`](sounds-common.proto.txt).

```proto
package tibia.protobuf.sound;

message Sounds {
  repeated Sound                sound                   = 1;
  repeated NumericSoundEffect   numeric_sound_effect    = 2;
  repeated AmbienceStream       ambience_stream         = 3;
  repeated AmbienceObjectStream ambience_object_stream  = 4;
  repeated MusicTemplate        music_template          = 5;
}

message Sound {
  optional uint32 id                = 1;
  optional string filename          = 2;   // "sound-<sha256>.ogg"
  optional string original_filename = 3;   // puste we wszystkich znanych buildach
  optional bool   is_stream         = 4;   // dlugie pliki: muzyka, petle ambience
}

message NumericSoundEffect {
  optional uint32            id                  = 1;  // == wartosc ESoundEffectType
  optional ENumericSoundType numeric_sound_type  = 2;  // kategoria miksera
  optional MinMaxFloat       random_pitch        = 3;
  optional MinMaxFloat       random_volume       = 4;
  oneof numericsoundeffect_oneof {
    SimpleSoundEffect simple_sound_effect = 5;         // jeden sound_id
    RandomSoundEffect random_sound_effect = 6;         // losowanie z listy
  }
}

message AmbienceStream {
  optional uint32              id               = 1;
  optional uint32              looping_sound_id = 2;   // dlugi plik grany w petli
  repeated DelayedSoundEffect  delayed_effects  = 3;   // jednorazowe dzwieki na wierzchu
}

message AmbienceObjectStream {
  optional uint32                          id                       = 1;
  repeated uint32                          counted_appearance_types = 2;  // id obiektow
  repeated AppearanceTypesCountSoundEffect sound_effects            = 3;  // progi ilosciowe
  optional uint32                          max_sound_distance       = 4;
}

message MusicTemplate {
  optional uint32     id         = 1;
  optional uint32     sound_id   = 2;
  optional EMusicType music_type = 3;
}
```

## Sciezka od zdarzenia w grze do pliku

```
serwer -> GAMESERVER_MESSAGE_TYPE_SOUNDTRIGGER
   SOUND_TRIGGER_TYPE_NUMERIC_SOUND   -> NumericSoundEffect.id  (== ESoundEffectType)
   SOUND_TRIGGER_TYPE_AMBIENCE_STREAM -> AmbienceStream.id
   SOUND_TRIGGER_TYPE_MUSIC_TEMPLATE  -> MusicTemplate.id

NumericSoundEffect
   .numeric_sound_type -> ENumericSoundType   (kategoria = suwak/checkbox w opcjach)
   .simple_sound_effect.sound_id | .random_sound_effect.random_sound_id[]

Sound.id -> Sound.filename
```

## Dwie warstwy nazw

**`ESoundEffectType`**: 336 wartosci, konkretne zdarzenie:

| zakres | co opisuje | przyklady |
|---|---|---|
| od 0 do 20 | ataki bronia, chybienia | `CloseAttackSword`, `DistAttackBowShot`, `NoDamage` |
| od 100 do 107 | melee potworow | `MonsterMeleeAttackClaw`, `MonsterMeleeAttackAcid` |
| od 1001 do 1245 | czary i runy gracza | `SpellFireballRune`, `SpellUltimateHealing` |
| od 2002 do 2069 | czary potworow | `MonsterSpellWaveFire`, `MonsterSpellLargeAreaDeath` |
| od 2500 do 2544 | pomruki potworow | `DragonBark`, `UndeadBark`, `HumanFemaleBark` |
| od 2600 do 2644 | smierc potworow | `DemonDeath`, `SlimeDeath`, `ApeDeath` |
| 10001 | godspell | `GodspellKillAllMonsters` |

**`ENumericSoundType`**: 20 wartosci, kategoria miksera, do ktorej podpiete sa
suwaki i checkboxy w opcjach klienta:

| # | nazwa | opcja w kliencie |
|---|---|---|
| 1 | `SPELL_ATTACK` | Battle Sounds &gt; Attack Spells |
| 2 | `SPELL_HEALING` | Battle Sounds &gt; Healing Spells |
| 3 | `SPELL_SUPPORT` | Battle Sounds &gt; Support Spells |
| 4 | `WEAPON_ATTACK` | Battle Sounds &gt; Weapons |
| 5 | `CREATURE_NOISE` | Battle Sounds &gt; Creatures / Noises |
| 6 | `CREATURE_DEATH` | Battle Sounds &gt; Creatures / Death |
| 7 | `CREATURE_ATTACK` | brak wpisow w banku, patrz nizej |
| 8 | `AMBIENCE_STREAM` | Sound &gt; Ambience Volume |
| 9 | `FOOD_AND_DRINK` | Sound &gt; Eating |
| 10 | `ITEM_MOVEMENT` | Sound &gt; Move Item |
| 11 | `EVENT` | Sound &gt; Event Volume |
| 12 | `UI` | UI Sounds &gt; UI Interactions |
| 13 | `WHISPER_WITHOUT_OPEN_CHAT` | UI Sounds &gt; wiadomosc prywatna bez otwartej zakladki |
| 14 | `CHAT_MESSAGE` | UI Sounds &gt; przelaczniki kanalow |
| 15 | `PARTY` | UI Sounds &gt; Party |
| 16 | `VIP_LIST` | UI Sounds &gt; VIP List |
| 17 | `RAID_ANNOUNCEMENT` | UI Sounds &gt; Raid Announcements |
| 18 | `SERVER_MESSAGE` | UI Sounds &gt; komunikaty serwera |
| 19 | `SPELL_GENERIC` | fallback dla czarow |

## Ustalenia, ktore latwo przeoczyc

- **`CREATURE_ATTACK` (7) nie ma ani jednego wpisu.** Melee potworow
  (`MonsterMeleeAttack*` od 100 do 107) jest otagowane jako `WEAPON_ATTACK` (4),
  tak samo jak ciosy gracza. Checkbox "Creatures &gt; Attacks" nie moze wiec dzialac
  po `numeric_sound_type`, bo klient musi rozroznia zrodlo triggera.
- **11 wartosci `ESoundEffectType` nie ma odpowiadajacego `NumericSoundEffect`**, wiec
  sa nieme: `Silence` (0), `SpellOrRune` (10), `Other` (11), `SpellSummonMonkFamiliar` (1198),
  `MonsterSpellAgony` (2069), `MammalMammothBark` (2531), `HumanSageBark` (2542),
  `HumanCroneBark` (2543), `ApeBark` (2544), `MammalMammothDeath` (2631),
  `GodspellKillAllMonsters` (10001).
- **267 wpisow `NumericSoundEffect` (id 2645+) nie ma nazwy w enumie.** To dzwieki
  ambience, UI, przedmiotow i eventow adresowane wylacznie surowym id. Aplikacja
  etykietuje je jako `<kategoria> #<id>`, np. `raid_announcement #2776`.
- **`original_filename` jest puste.** W schemacie jest, ale CipSoft go nie wypelnia,
  wiec oryginalnych nazw plikow nie da sie odzyskac. Tagi Vorbis tez nie pomagaja:
  821 z 844 plikow nie ma zadnych, reszta ma tylko `ARTIST=CipSoft GmbH`.
- **Launcher przywraca podmienione pliki.** Weryfikuje je po `packedhash` z `assets.json`,
  wiec kazdy patch cofa zmiany.
- **Oryginalow nie da sie pobrac z CDN.**
  `https://static.tibia.com/launcher/assets-current/sounds/sound-<hash>.ogg` zwraca
  HTTP 403 z naglowkiem `cf-mitigated: challenge`.

## Statystyki banku (15.32.df7b29)

| sekcja | liczba |
|---|---|
| `Sound` | 844 (wszystkie pliki `.ogg` w katalogu, zero sierot) |
| `NumericSoundEffect` | 592 |
| `AmbienceStream` | 91 |
| `AmbienceObjectStream` | 9 |
| `MusicTemplate` | 25 |

Rozklad plikow po kategoriach (liczone po unikalnych `sound_id`, sumy sie nie
skladaja do 844, bo ten sam plik bywa uzyty przez kilka efektow):

| kategoria | plikow |
|---|---|
| `CREATURE_NOISE` | 213 |
| `AMBIENCE_STREAM` | 188 |
| `SPELL_ATTACK` | 168 |
| `WEAPON_ATTACK` | 76 |
| `CREATURE_DEATH` | 65 |
| `SPELL_SUPPORT` | 48 |
| `MUSIC` | 25 |
| `ITEM_MOVEMENT` | 19 |
| `UI`, `FOOD_AND_DRINK` | po 10 |
| `SPELL_HEALING` | 7 |
| `EVENT`, `SPELL_GENERIC` | po 5 |
| `PARTY` | 4 |
| `CHAT_MESSAGE`, `VIP_LIST` | po 2 |
| `RAID_ANNOUNCEMENT`, `SERVER_MESSAGE`, `WHISPER_WITHOUT_OPEN_CHAT` | po 1 |

Pelna mapa plik &rarr; akcja: [`sound_map.csv`](sound_map.csv).
Raport ze wszystkimi tabelami: [`sound_actions.md`](sound_actions.md).

## Jak to zostalo ustalone

Skrypty uzyte przy analizie leza w `tools/` (Python, referencja, ktorej aplikacja nie uzywa):

| skrypt | co robi |
|---|---|
| `strings.py` | zrzut stringow ASCII/UTF-16 z binarki |
| `descextract.py` | znajduje i parsuje `FileDescriptorProto` w `client.exe` |
| `render.py` | zamienia deskryptor JSON na czytelny `.proto` |
| `parse_sounds.py` | dekoduje `sounds-<sha256>.dat` |
| `build_map.py` | sklada mape plik &rarr; akcja (`sound_map.csv`) |
| `gen_md.py` | generuje raport `sound_actions.md` |

Odpowiedniki w JavaScripcie (`electron/lib/descriptors.js`, `soundBank.js`, `catalog.js`)
sa tym, czego uzywa aplikacja. Skrypty w Pythonie zostaly jako slad pochodzenia
i punkt odniesienia przy sprawdzaniu portu.
