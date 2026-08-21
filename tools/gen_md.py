import json, csv, collections

A = 'C:/Workspaces/Tibia/_analysis/'
d = json.load(open(A + 'sounds_parsed.json'))
desc = json.load(open(A + 'desc_sounds-common_proto.json'))
E = {e['name']: {v.get('number', 0): v['name'] for v in e['values']} for e in desc['enums']}
SFX = E['ESoundEffectType']
NST = E['ENumericSoundType']
MUS = E['EMusicType']
sounds = {s['id']: s for s in d['sounds']}
rows = {int(r['sound_id']): r for r in csv.DictReader(open(A + 'sound_map.csv', encoding='utf-8'))}

OPT = {
    1: 'Battle Sounds > Own/Others "Attack Spells" (soundBattle{Own,Others}AttackSpellsEnabled)',
    2: 'Battle Sounds > Own/Others "Healing Spells" (soundBattle*HealingSpellsEnabled)',
    3: 'Battle Sounds > Own/Others "Support Spells" (soundBattle*SupportSpellsEnabled)',
    4: 'Battle Sounds > Own/Others "Weapons" (soundBattle*WeaponsEnabled)',
    5: 'Battle Sounds > Creatures "Noises" (soundBattleCreaturesNoisesEnabled)',
    6: 'Battle Sounds > Creatures "Death" (soundBattleCreaturesDeathEnabled)',
    7: 'Battle Sounds > Creatures "Attacks" (soundBattleCreaturesAttacksEnabled)',
    8: 'Sound > "Ambience Volume" (soundAmbienceVolume)',
    9: 'Sound > "Eating" (soundEatingEnabled + soundItemsVolume)',
    10: 'Sound > "Move Item" (soundMoveItemEnabled + soundItemsVolume)',
    11: 'Sound > "Event Volume" (soundEventsVolume)',
    12: 'UI Sounds > "UI Interactions" (soundUiInteractionsEnabled + soundUiVolume)',
    13: 'UI Sounds > private message without open tab (PrivateMessagesWithoutTabEnabled)',
    14: 'UI Sounds > chat toggles (Party/Guild/Private/Npc/Global/TeamFinder/System MessagesEnabled)',
    15: 'UI Sounds > "Party" (soundPartyEnabled)',
    16: 'UI Sounds > "VIP List" (soundVipEnabled)',
    17: 'UI Sounds > "Raid Announcements" (RaidMessagesEnabled)',
    18: 'UI Sounds > system / server broadcast (SystemMessagesEnabled)',
    19: 'Battle Sounds > generic spell fallback',
}

out = []
w = out.append
w('# Tibia client - sound bank / "action" map')
w('')
w('Source: `packages/Tibia/sounds/sounds-ce31d979....dat` (protobuf `tibia.protobuf.sound.Sounds`),')
w('decoded with the `sounds.proto` / `sounds-common.proto` FileDescriptorProto blobs embedded in `bin/client.exe`')
w('(offsets 0x01bc9020 and 0x01bc50c0).')
w('')
w('- 844 `.ogg` files in `sounds/`, all 844 are referenced by the bank (0 orphans, 0 missing).')
w('- 592 `NumericSoundEffect`, 91 `AmbienceStream`, 9 `AmbienceObjectStream`, 25 `MusicTemplate`.')
w('- 325 of the 336 `ESoundEffectType` enum values resolve to a `NumericSoundEffect`;')
w('  267 further effect entries (ids 2645+) have no enum name - ambience / UI / item / event sounds')
w('  addressed by raw id only.')
w('')
w('## Trigger chain')
w('')
w('```')
w('server -> GAMESERVER_MESSAGE_TYPE_SOUNDTRIGGER')
w('   SOUND_TRIGGER_TYPE_NUMERIC_SOUND   -> NumericSoundEffect.id  (== ESoundEffectType value)')
w('   SOUND_TRIGGER_TYPE_AMBIENCE_STREAM -> AmbienceStream.id')
w('   SOUND_TRIGGER_TYPE_MUSIC_TEMPLATE  -> MusicTemplate.id')
w('')
w('NumericSoundEffect')
w('   .numeric_sound_type  -> ENumericSoundType   = the mixer category / "action"')
w('   .simple_sound_effect.sound_id   OR   .random_sound_effect.random_sound_id[]')
w('   .random_pitch / .random_volume  (MinMaxFloat)')
w('')
w('Sound.id -> Sound.filename = "sound-<sha256>.ogg"')
w('(Sound.original_filename exists in the schema but is empty in this build.)')
w('```')
w('')
w('## ENumericSoundType - the actual "actions"')
w('')
by = collections.defaultdict(list)
for e in d['nse']:
    by[e.get('numeric_sound_type', 0)].append(e)
distinct = collections.defaultdict(set)
for e in d['nse']:
    n = NST[e.get('numeric_sound_type', 0)]
    for sid in (e.get('random') or e.get('simple') or []):
        distinct[n].add(sid)
files = {k: len(v) for k, v in distinct.items()}
w('| # | ENumericSoundType | effects | .ogg files | client option that gates it |')
w('|---|---|---|---|---|')
for t in sorted(by):
    n = NST[t]
    w('| %d | `%s` | %d | %d | %s |' % (t, n, len(by[t]), files.get(n, 0), OPT.get(t, '')))
w('| - | `AmbienceStream` (looping bed) | %d | %d | Sound > Ambience Volume |'
  % (len(d['amb']), sum(1 for r in rows.values() if r['roles'].startswith('AMBIENCE_STREAM'))))
w('| - | `AmbienceObjectStream` (per-object loops) | %d | %d | Sound > Ambience Volume |'
  % (len(d['ambobj']), sum(1 for r in rows.values() if r['roles'].startswith('AMBIENCE_OBJECT'))))
w('| - | `MusicTemplate` | %d | %d | Sound > Music Volume / Anthem |'
  % (len(d['music']), sum(1 for r in rows.values() if r['roles'].startswith('MUSIC'))))
w('')
w('The `.ogg files` column counts distinct sound ids, so it does not sum to 844 - the same')
w('sample is reused by several effects (e.g. a shared "swing" across weapon types).')
w('')
w('Notes:')
w('')
w('- `NUMERIC_SOUND_TYPE_CREATURE_ATTACK` (7) has **zero** entries in this bank. Monster melee')
w('  effects (`SOUND_EFFECT_TYPE_MonsterMeleeAttack*` 100-107, `MonsterCloseAttackFist` 2) are')
w('  tagged `NUMERIC_SOUND_TYPE_WEAPON_ATTACK` (4), same as player weapon swings. So the')
w('  "Creatures > Attacks" checkbox cannot be keyed off numeric_sound_type alone - the client')
w('  must decide by the source creature of the trigger.')
w('- 11 `ESoundEffectType` values have no `NumericSoundEffect` and are therefore silent in this')
w('  build: `Silence` (0), `SpellOrRune` (10), `Other` (11), `SpellSummonMonkFamiliar` (1198),')
w('  `MonsterSpellAgony` (2069), `MammalMammothBark` (2531), `HumanSageBark` (2542),')
w('  `HumanCroneBark` (2543), `ApeBark` (2544), `MammalMammothDeath` (2631),')
w('  `GodspellKillAllMonsters` (10001).')
w('')
w('## Option pages in the client (C++ QML page classes)')
w('')
w('```')
w('TSoundQMLOptionsPage         soundEnabled masterVolume musicVolume anthemEnabled ambienceVolume')
w('                             itemsVolume eatingEnabled moveItemEnabled eventsVolume soundDevice')
w('TBattleSoundsQMLOptionsPage  ownVolume own{,Attack,Healing,Support}SpellsEnabled ownWeaponsEnabled')
w('                             othersVolume others{...}Enabled')
w('                             creaturesVolume creatures{Noises,Death,Attacks}Enabled')
w('TUISoundsQMLOptionsPage      uiVolume uiInteractionsEnabled partyEnabled vipEnabled chatEnabled')
w('                             party/guild/private/privateWithoutTab/npc/global/teamFinder/')
w('                             RAID/system MessagesEnabled')
w('```')
w('')
w('Persisted in `packages/Tibia/conf/clientoptions.json` under `/options/`.')
w('')
w('## Specific answers')
w('')
raid = [r for r in rows.values() if 'RAID_ANNOUNCEMENT' in r['roles']][0]
w('### "echo raid" / raid announcement')
w('')
w('- action: `NUMERIC_SOUND_TYPE_RAID_ANNOUNCEMENT` (value 17)')
w('- `NumericSoundEffect` id **2776**, `SimpleSoundEffect` -> Sound id **%s**' % raid['sound_id'])
w('- file: `sounds/%s` (%s s)' % (raid['file'], raid['duration_s']))
w('- UI label "Raid Announcements", option key `/options/RaidMessagesEnabled`, volume `soundUiVolume`')
w('- it is the only sound in the whole bank with this type.')
w('')
w('### monsters')
w('')
w('- idle barks: `NUMERIC_SOUND_TYPE_CREATURE_NOISE` (5) - enum `SOUND_EFFECT_TYPE_*Bark`, ids 2500-2544')
w('  (+ unnamed ids 2645, 2715, 2717, ... for newer creature classes)')
w('- deaths: `NUMERIC_SOUND_TYPE_CREATURE_DEATH` (6) - enum `SOUND_EFFECT_TYPE_*Death`, ids 2600-2644')
w('- melee hits: `SOUND_EFFECT_TYPE_MonsterMeleeAttack{Fist,Claw,Bite,Rip,Acid,Magic,Ethereal,Construct}`')
w('  ids 100-107, plus `MonsterCloseAttackFist` = 2')
w('- monster spells: `SOUND_EFFECT_TYPE_MonsterSpell*` ids 2002-2069')
w('  (SingleTarget / SmallArea / LargeArea / Wave x Fire,Energy,Earth,Ice,Death,Holy,Hit,LifeDrain,')
w('  ManaDrain,Drowning,Bleeding,Healing, plus Challenge/Speed/Summon/Teleport/Fear/Root/Agony/...)')
w('  routed through SPELL_ATTACK / SPELL_HEALING / SPELL_SUPPORT.')
w('')
w('### environment / ambience')
w('')
w('- `NUMERIC_SOUND_TYPE_AMBIENCE_STREAM` (8): 125 one-shot ambience effects, ids 2651-2912, all unnamed.')
w('- `AmbienceStream` (91 entries): one long looping `.ogg` (`is_stream = true`) plus a list of')
w('  `DelayedSoundEffect` (`numeric_sound_effect_id` + `delay_seconds`) layered on top.')
w('  The server picks the stream id per area.')
w('- `AmbienceObjectStream` (9 entries): loops driven by how many objects from')
w('  `counted_appearance_types` are visible; each `AppearanceTypesCountSoundEffect` gives a')
w('  `count` threshold -> `looping_sound_id`, with `max_sound_distance` for the distance fade.')
w('- Engine tunables (built-in `:/conf/config.ini`, `[SOUND]` section):')
w('  `ambienceStreamFadeDuration=1000`, `ambienceObjectStreamFadeDuration=500`,')
w('  `distanceFadePerStep=10`, `distanceFadeBase=100`, `distanceModifierForZ=3`,')
w('  `disableAmbienceStreams=false`, `disableAmbienceObjectSounds=false`,')
w('  `ambienceStreamSingleSoundsDelayMultiplier`.')
w('')
w('## AmbienceStream table')
w('')
w('| stream id | looping sound id | looping file | delayed effects (nse id @ delay) |')
w('|---|---|---|---|')
for a in sorted(d['amb'], key=lambda x: x['id']):
    ls = a.get('looping_sound_id')
    fn = sounds[ls]['filename'] if ls in sounds else '-'
    de = ', '.join('%d@%ds' % (x.get('numeric_sound_effect_id', 0), x.get('delay_seconds', 0))
                   for x in a['delayed'])
    w('| %d | %s | `%s` | %s |' % (a['id'], ls, fn, de))
w('')
w('## AmbienceObjectStream table')
w('')
for a in sorted(d['ambobj'], key=lambda x: x['id']):
    w('- **stream %d** max_sound_distance=%s, thresholds: %s'
      % (a['id'], a.get('max_sound_distance', '-'),
         ', '.join('count>=%d -> sound %d' % (x['count'], x['looping_sound_id'])
                   for x in a['sound_effects'])))
    w('  - appearance (item) ids: %s' % ', '.join(map(str, a['counted_appearance_types'])))
w('')
w('## MusicTemplate table')
w('')
w('| template id | sound id | EMusicType | file |')
w('|---|---|---|---|')
for m in sorted(d['music'], key=lambda x: x['id']):
    w('| %d | %s | %s | `%s` |' % (m['id'], m.get('sound_id'), MUS.get(m.get('music_type', 0)),
                                   sounds[m['sound_id']]['filename']))
w('')
w('## Full NumericSoundEffect listing')
w('')
w('| nse id | ESoundEffectType name | ENumericSoundType | sound ids | files |')
w('|---|---|---|---|---|')
for e in sorted(d['nse'], key=lambda x: x['id']):
    ids = e.get('random') or e.get('simple') or []
    w('| %d | %s | %s | %s | %s |'
      % (e['id'], SFX.get(e['id'], '*(unnamed)*'), NST.get(e.get('numeric_sound_type', 0)),
         ', '.join(map(str, ids)),
         '<br>'.join(sounds[i]['filename'] for i in ids if i in sounds)))

open(A + 'sound_actions.md', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('written', len(out), 'lines')
