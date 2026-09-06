# The Tibia client sound bank format

Recovered from client **15.32.df7b29** (Windows). Everything below follows from the protobuf
descriptors compiled into `client.exe` and from the contents of the files themselves, without
any CipSoft documentation.

## File layout

```
<client>/
  packages/Tibia/
    package.json                       launcher manifest: version + hashes of program files
    assets.json                        asset manifest: packedhash + packedsize of every .ogg
    assets.json.sha256
    bin/client.exe                     contains the protobuf descriptors (action names)
    sounds/
      catalog-sound.json               [ { "file": "sounds-<sha256>.dat", "type": "sounds" } ]
      sounds-<sha256>.dat              the bank (protobuf tibia.protobuf.sound.Sounds)
      sound-<sha256>.ogg               844 Vorbis files
```

**A sound file's name is the sha256 of its contents.** That makes integrity verification need
no extra data. `assets.json` repeats the same hash in the `packedhash` field and adds
`packedsize`.

## Protobuf schemas

Recovered from `client.exe`, full listings: [`sounds.proto.txt`](sounds.proto.txt),
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
  optional string original_filename = 3;   // empty in every known build
  optional bool   is_stream         = 4;   // long files: music, ambience loops
}

message NumericSoundEffect {
  optional uint32            id                  = 1;  // == ESoundEffectType value
  optional ENumericSoundType numeric_sound_type  = 2;  // mixer category
  optional MinMaxFloat       random_pitch        = 3;
  optional MinMaxFloat       random_volume       = 4;
  oneof numericsoundeffect_oneof {
    SimpleSoundEffect simple_sound_effect = 5;         // a single sound_id
    RandomSoundEffect random_sound_effect = 6;         // pick at random from a list
  }
}

message AmbienceStream {
  optional uint32              id               = 1;
  optional uint32              looping_sound_id = 2;   // a long file played in a loop
  repeated DelayedSoundEffect  delayed_effects  = 3;   // one-shot sounds layered on top
}

message AmbienceObjectStream {
  optional uint32                          id                       = 1;
  repeated uint32                          counted_appearance_types = 2;  // object ids
  repeated AppearanceTypesCountSoundEffect sound_effects            = 3;  // count thresholds
  optional uint32                          max_sound_distance       = 4;
}

message MusicTemplate {
  optional uint32     id         = 1;
  optional uint32     sound_id   = 2;
  optional EMusicType music_type = 3;
}
```

## The path from an in-game event to a file

```
server -> GAMESERVER_MESSAGE_TYPE_SOUNDTRIGGER
   SOUND_TRIGGER_TYPE_NUMERIC_SOUND   -> NumericSoundEffect.id  (== ESoundEffectType)
   SOUND_TRIGGER_TYPE_AMBIENCE_STREAM -> AmbienceStream.id
   SOUND_TRIGGER_TYPE_MUSIC_TEMPLATE  -> MusicTemplate.id

NumericSoundEffect
   .numeric_sound_type -> ENumericSoundType   (category = slider/checkbox in the options)
   .simple_sound_effect.sound_id | .random_sound_effect.random_sound_id[]

Sound.id -> Sound.filename
```

## Two layers of names

**`ESoundEffectType`**: 336 values, a specific event:

| range | what it describes | examples |
|---|---|---|
| 0 to 20 | weapon attacks, misses | `CloseAttackSword`, `DistAttackBowShot`, `NoDamage` |
| 100 to 107 | monster melee | `MonsterMeleeAttackClaw`, `MonsterMeleeAttackAcid` |
| 1001 to 1245 | player spells and runes | `SpellFireballRune`, `SpellUltimateHealing` |
| 2002 to 2069 | monster spells | `MonsterSpellWaveFire`, `MonsterSpellLargeAreaDeath` |
| 2500 to 2544 | monster barks | `DragonBark`, `UndeadBark`, `HumanFemaleBark` |
| 2600 to 2644 | monster deaths | `DemonDeath`, `SlimeDeath`, `ApeDeath` |
| 10001 | godspell | `GodspellKillAllMonsters` |

**`ENumericSoundType`**: 20 values, the mixer category that the sliders and checkboxes in the
client options are wired to:

| # | name | option in the client |
|---|---|---|
| 1 | `SPELL_ATTACK` | Battle Sounds &gt; Attack Spells |
| 2 | `SPELL_HEALING` | Battle Sounds &gt; Healing Spells |
| 3 | `SPELL_SUPPORT` | Battle Sounds &gt; Support Spells |
| 4 | `WEAPON_ATTACK` | Battle Sounds &gt; Weapons |
| 5 | `CREATURE_NOISE` | Battle Sounds &gt; Creatures / Noises |
| 6 | `CREATURE_DEATH` | Battle Sounds &gt; Creatures / Death |
| 7 | `CREATURE_ATTACK` | no entries in the bank, see below |
| 8 | `AMBIENCE_STREAM` | Sound &gt; Ambience Volume |
| 9 | `FOOD_AND_DRINK` | Sound &gt; Eating |
| 10 | `ITEM_MOVEMENT` | Sound &gt; Move Item |
| 11 | `EVENT` | Sound &gt; Event Volume |
| 12 | `UI` | UI Sounds &gt; UI Interactions |
| 13 | `WHISPER_WITHOUT_OPEN_CHAT` | UI Sounds &gt; private message with no tab open |
| 14 | `CHAT_MESSAGE` | UI Sounds &gt; channel toggles |
| 15 | `PARTY` | UI Sounds &gt; Party |
| 16 | `VIP_LIST` | UI Sounds &gt; VIP List |
| 17 | `RAID_ANNOUNCEMENT` | UI Sounds &gt; Raid Announcements |
| 18 | `SERVER_MESSAGE` | UI Sounds &gt; server messages |
| 19 | `SPELL_GENERIC` | fallback for spells |

## Findings that are easy to miss

- **`CREATURE_ATTACK` (7) has not a single entry.** Monster melee
  (`MonsterMeleeAttack*` 100 to 107) is tagged as `WEAPON_ATTACK` (4), the same as player
  swings. So the "Creatures &gt; Attacks" checkbox cannot work off `numeric_sound_type`,
  because the client has to tell the trigger source apart.
- **11 `ESoundEffectType` values have no matching `NumericSoundEffect`**, so they are silent:
  `Silence` (0), `SpellOrRune` (10), `Other` (11), `SpellSummonMonkFamiliar` (1198),
  `MonsterSpellAgony` (2069), `MammalMammothBark` (2531), `HumanSageBark` (2542),
  `HumanCroneBark` (2543), `ApeBark` (2544), `MammalMammothDeath` (2631),
  `GodspellKillAllMonsters` (10001).
- **267 `NumericSoundEffect` entries (ids 2645+) have no name in the enum.** These are
  ambience, UI, item and event sounds addressed by raw id only. The app labels them as
  `<category> #<id>`, for example `raid_announcement #2776`.
- **`original_filename` is empty.** It exists in the schema, but CipSoft does not fill it, so
  the original file names cannot be recovered. Vorbis tags do not help either: 821 of 844
  files have none, and the rest only carry `ARTIST=CipSoft GmbH`.
- **The launcher restores replaced files.** It verifies them by `packedhash` from
  `assets.json`, so every patch reverts the changes.
- **Originals cannot be downloaded from the CDN.**
  `https://static.tibia.com/launcher/assets-current/sounds/sound-<hash>.ogg` returns
  HTTP 403 with a `cf-mitigated: challenge` header.

## Bank statistics (15.32.df7b29)

| section | count |
|---|---|
| `Sound` | 844 (every `.ogg` file in the directory, no orphans) |
| `NumericSoundEffect` | 592 |
| `AmbienceStream` | 91 |
| `AmbienceObjectStream` | 9 |
| `MusicTemplate` | 25 |

File distribution by category (counted by unique `sound_id`; the numbers do not add up to
844, because the same file is sometimes used by several effects):

| category | files |
|---|---|
| `CREATURE_NOISE` | 213 |
| `AMBIENCE_STREAM` | 188 |
| `SPELL_ATTACK` | 168 |
| `WEAPON_ATTACK` | 76 |
| `CREATURE_DEATH` | 65 |
| `SPELL_SUPPORT` | 48 |
| `MUSIC` | 25 |
| `ITEM_MOVEMENT` | 19 |
| `UI`, `FOOD_AND_DRINK` | 10 each |
| `SPELL_HEALING` | 7 |
| `EVENT`, `SPELL_GENERIC` | 5 each |
| `PARTY` | 4 |
| `CHAT_MESSAGE`, `VIP_LIST` | 2 each |
| `RAID_ANNOUNCEMENT`, `SERVER_MESSAGE`, `WHISPER_WITHOUT_OPEN_CHAT` | 1 each |

The full file to action map: [`sound_map.csv`](sound_map.csv).
The report with all the tables: [`sound_actions.md`](sound_actions.md).

## How this was worked out

The scripts used for the analysis live in `tools/` (Python, a reference the app does not use):

| script | what it does |
|---|---|
| `strings.py` | dumps ASCII/UTF-16 strings from the binary |
| `descextract.py` | finds and parses `FileDescriptorProto` inside `client.exe` |
| `render.py` | turns the JSON descriptor into a readable `.proto` |
| `parse_sounds.py` | decodes `sounds-<sha256>.dat` |
| `build_map.py` | assembles the file to action map (`sound_map.csv`) |
| `gen_md.py` | generates the `sound_actions.md` report |

The JavaScript equivalents (`electron/lib/descriptors.js`, `soundBank.js`, `catalog.js`) are
what the app actually uses. The Python scripts stay as a record of provenance and a reference
point when checking the port.
