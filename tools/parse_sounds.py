import json, struct, sys, collections

def rv(b,i):
    r=0;s=0
    while True:
        c=b[i]; i+=1
        r |= (c&0x7f)<<s
        if not c&0x80: break
        s+=7
    return r,i

def fields(b):
    i=0; n=len(b)
    while i<n:
        key,i=rv(b,i); f=key>>3; wt=key&7
        if wt==0: v,i=rv(b,i)
        elif wt==1: v=b[i:i+8]; i+=8
        elif wt==2:
            ln,i=rv(b,i); v=b[i:i+ln]; i+=ln
        elif wt==5: v=b[i:i+4]; i+=4
        else: raise ValueError(wt)
        yield f,wt,v

def f32(v): return struct.unpack('<f',v)[0]

data=open('C:/Workspaces/Tibia/packages/Tibia/sounds/sounds-ce31d979f9894dc453f296820bcfe7183b992fc08e0a8da3fb8eeb1bb0dfd654.dat','rb').read()

sounds={}; nse=[]; amb=[]; ambobj=[]; music=[]
for f,wt,v in fields(data):
    if f==1:
        s={}
        for g,w,x in fields(v):
            if g==1: s['id']=x
            elif g==2: s['filename']=x.decode()
            elif g==3: s['original_filename']=x.decode()
            elif g==4: s['is_stream']=bool(x)
        sounds[s['id']]=s
    elif f==2:
        e={}
        for g,w,x in fields(v):
            if g==1: e['id']=x
            elif g==2: e['numeric_sound_type']=x
            elif g==3: e['random_pitch']=[f32(y) for gg,ww,y in fields(x)]
            elif g==4: e['random_volume']=[f32(y) for gg,ww,y in fields(x)]
            elif g==5:
                e['simple']=[y for gg,ww,y in fields(x) if gg==1]
            elif g==6:
                e['random']=[y for gg,ww,y in fields(x) if gg==1]
        nse.append(e)
    elif f==3:
        a={'delayed':[]}
        for g,w,x in fields(v):
            if g==1: a['id']=x
            elif g==2: a['looping_sound_id']=x
            elif g==3:
                d={}
                for h,w2,y in fields(x):
                    if h==1: d['numeric_sound_effect_id']=y
                    elif h==2: d['delay_seconds']=y
                a['delayed'].append(d)
        amb.append(a)
    elif f==4:
        a={'counted_appearance_types':[],'sound_effects':[]}
        for g,w,x in fields(v):
            if g==1: a['id']=x
            elif g==2:
                if w==2:
                    j=0
                    while j<len(x):
                        val,j=rv(x,j); a['counted_appearance_types'].append(val)
                else: a['counted_appearance_types'].append(x)
            elif g==3:
                d={}
                for h,w2,y in fields(x):
                    if h==1: d['count']=y
                    elif h==2: d['looping_sound_id']=y
                a['sound_effects'].append(d)
            elif g==4: a['max_sound_distance']=x
        ambobj.append(a)
    elif f==5:
        m={}
        for g,w,x in fields(v):
            if g==1: m['id']=x
            elif g==2: m['sound_id']=x
            elif g==3: m['music_type']=x
        music.append(m)

print('sounds:',len(sounds),'numeric_sound_effect:',len(nse),'ambience_stream:',len(amb),'ambience_object_stream:',len(ambobj),'music_template:',len(music))
json.dump({'sounds':list(sounds.values()),'nse':nse,'amb':amb,'ambobj':ambobj,'music':music},open('C:/Workspaces/Tibia/_analysis/sounds_parsed.json','w'),indent=1)
ids=[e['id'] for e in nse]
print('nse id range',min(ids),max(ids),'unique',len(set(ids)))
print('sound id range',min(sounds),max(sounds))
print('sample nse:',nse[:5])
print('sample amb:',amb[:3])
print('sample ambobj:',ambobj[:2])
print('sample music:',music[:5])
