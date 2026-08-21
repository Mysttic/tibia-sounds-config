import sys, json

def rv(b,i):
    r=0;s=0
    while True:
        c=b[i]; i+=1
        r |= (c&0x7f)<<s
        if not c&0x80: break
        s+=7
    return r,i

def fields(b, start=0, end=None):
    if end is None: end=len(b)
    i=start
    while i<end:
        key,i = rv(b,i)
        f=key>>3; wt=key&7
        if f==0: raise ValueError('field 0')
        if wt==0:
            v,i=rv(b,i); yield f,0,v
        elif wt==1:
            v=b[i:i+8]; i+=8; yield f,1,v
        elif wt==2:
            ln,i=rv(b,i)
            if i+ln>end: raise ValueError('len overflow')
            v=b[i:i+ln]; i+=ln; yield f,2,v
        elif wt==5:
            v=b[i:i+4]; i+=4; yield f,5,v
        else:
            raise ValueError('wt %d'%wt)

TYPES={1:'double',2:'float',3:'int64',4:'uint64',5:'int32',6:'fixed64',7:'fixed32',8:'bool',
9:'string',10:'group',11:'message',12:'bytes',13:'uint32',14:'enum',15:'sfixed32',16:'sfixed64',
17:'sint32',18:'sint64'}
LABELS={1:'optional',2:'required',3:'repeated'}

def parse_field(b):
    d={}
    for f,wt,v in fields(b):
        if f==1: d['name']=v.decode()
        elif f==3: d['number']=v
        elif f==4: d['label']=LABELS.get(v,v)
        elif f==5: d['type']=TYPES.get(v,v)
        elif f==6: d['type_name']=v.decode()
        elif f==9: d['oneof_index']=v
    return d

def parse_enum(b):
    d={'name':None,'values':[]}
    for f,wt,v in fields(b):
        if f==1: d['name']=v.decode()
        elif f==2:
            ev={}
            for g,w2,x in fields(v):
                if g==1: ev['name']=x.decode()
                elif g==2: ev['number']=x
            d['values'].append(ev)
    return d

def parse_msg(b):
    d={'name':None,'fields':[],'nested':[],'enums':[],'oneofs':[]}
    for f,wt,v in fields(b):
        if f==1: d['name']=v.decode()
        elif f==2: d['fields'].append(parse_field(v))
        elif f==3: d['nested'].append(parse_msg(v))
        elif f==4: d['enums'].append(parse_enum(v))
        elif f==8:
            for g,w2,x in fields(v):
                if g==1: d['oneofs'].append(x.decode())
    return d

def parse_file(b):
    d={'name':None,'package':None,'deps':[],'messages':[],'enums':[],'syntax':None}
    for f,wt,v in fields(b):
        if f==1: d['name']=v.decode()
        elif f==2: d['package']=v.decode()
        elif f==3: d['deps'].append(v.decode())
        elif f==4: d['messages'].append(parse_msg(v))
        elif f==5: d['enums'].append(parse_enum(v))
        elif f==12: d['syntax']=v.decode()
    return d

def find_descriptor(data, protoname):
    needle = bytes([0x0a, len(protoname)]) + protoname.encode()
    res=[]
    off=0
    while True:
        p = data.find(needle, off)
        if p<0: break
        off = p+1
        # greedily extend
        best=None
        end=p+len(needle)
        lim=min(len(data), p+400000)
        i=end
        try:
            while i<lim:
                start_i=i
                key,i2 = rv(data,i)
                f=key>>3; wt=key&7
                if f==0 or f>20 or wt not in (0,1,2,5): break
                if wt==0:
                    v,i2=rv(data,i2)
                elif wt==1: i2+=8
                elif wt==5: i2+=4
                elif wt==2:
                    ln,i3=rv(data,i2)
                    if ln>200000: break
                    i2=i3+ln
                    if i2>len(data): break
                i=i2
                best=i
        except Exception:
            pass
        if best:
            res.append((p, data[p:best]))
    return res

if __name__=='__main__':
    data=open(sys.argv[1],'rb').read()
    for name in sys.argv[2:]:
        found=find_descriptor(data,name)
        print('###',name,'candidates:',len(found))
        for p,blob in found:
            try:
                d=parse_file(blob)
            except Exception as e:
                print('  @%08x parse fail %s len=%d'%(p,e,len(blob))); continue
            if d['name']!=name: continue
            print('  @%08x len=%d pkg=%s msgs=%d enums=%d'%(p,len(blob),d['package'],len(d['messages']),len(d['enums'])))
            open('C:/Workspaces/Tibia/_analysis/desc_%s.json'%name.replace('.','_'),'w').write(json.dumps(d,indent=1))
