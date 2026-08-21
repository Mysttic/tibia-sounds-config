import json, os, struct, collections, csv

SD='C:/Workspaces/Tibia/packages/Tibia/sounds/'
A='C:/Workspaces/Tibia/_analysis/'
d=json.load(open(A+'sounds_parsed.json'))
desc=json.load(open(A+'desc_sounds-common_proto.json'))
E={e['name']:{v.get('number',0):v['name'] for v in e['values']} for e in desc['enums']}
SFX=E['ESoundEffectType']; NST=E['ENumericSoundType']; MUS=E['EMusicType']

sounds={s['id']:s for s in d['sounds']}
nse={e['id']:e for e in d['nse']}

def dur(fn):
    p=SD+fn
    sz=os.path.getsize(p)
    with open(p,'rb') as f:
        f.seek(max(0,sz-65536)); tail=f.read()
        i=tail.rfind(b'OggS')
        if i<0: return None
        gran=struct.unpack('<q',tail[i+6:i+14])[0]
        f.seek(0); head=f.read(4096)
        j=head.find(b'\x01vorbis')
        if j<0: return None
        rate=struct.unpack('<I',head[j+12:j+16])[0]
        return round(gran/rate,2) if rate else None

roles=collections.defaultdict(list)   # sound_id -> list of role strings

for e in d['nse']:
    t=NST.get(e.get('numeric_sound_type',0),'TYPE_%s'%e.get('numeric_sound_type'))
    nm=SFX.get(e['id'])
    label='%s / nse#%d%s'%(t,e['id'],(' = '+nm) if nm else '')
    for sid in (e.get('random') or e.get('simple') or []):
        roles[sid].append(label)

for a in d['amb']:
    if a.get('looping_sound_id'): roles[a['looping_sound_id']].append('AMBIENCE_STREAM#%d / looping'%a['id'])
for a in d['ambobj']:
    for se in a['sound_effects']:
        roles[se['looping_sound_id']].append('AMBIENCE_OBJECT_STREAM#%d / looping@count>=%d'%(a['id'],se['count']))
for m in d['music']:
    roles[m['sound_id']].append('MUSIC / %s / template#%d'%(MUS.get(m.get('music_type',0),m.get('music_type')),m['id']))

rows=[]
for sid in sorted(sounds):
    s=sounds[sid]
    rows.append({'sound_id':sid,'file':s['filename'],'is_stream':bool(s.get('is_stream')),
                 'duration_s':dur(s['filename']),'size':os.path.getsize(SD+s['filename']),
                 'roles':' | '.join(roles.get(sid,[])) or 'UNREFERENCED'})
with open(A+'sound_map.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

unref=[r for r in rows if r['roles']=='UNREFERENCED']
print('total sounds',len(rows),'unreferenced',len(unref))
print('files on disk not in bank:', len([x for x in os.listdir(SD) if x.endswith('.ogg')])-len(rows))
disk={x for x in os.listdir(SD) if x.endswith('.ogg')}
bank={s['filename'] for s in sounds.values()}
print('bank missing from disk:',len(bank-disk),'disk not in bank:',len(disk-bank))
for r in unref[:20]: print(' unref', r['sound_id'], r['duration_s'],'s', r['file'][:30])
