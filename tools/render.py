import json,sys
d=json.load(open(sys.argv[1]))
def emit_enum(e,ind):
    print(' '*ind+'enum %s {'%e['name'])
    for v in e['values']:
        print(' '*(ind+2)+'%s = %s;'%(v['name'],v.get('number',0)))
    print(' '*ind+'}')
def emit_msg(m,ind):
    print(' '*ind+'message %s {'%m['name'])
    for e in m['enums']: emit_enum(e,ind+2)
    for n in m['nested']: emit_msg(n,ind+2)
    for f in m['fields']:
        t=f.get('type_name') or f.get('type')
        oo = ''  if 'oneof_index' not in f else '  // oneof#%d %s'%(f['oneof_index'], m['oneofs'][f['oneof_index']] if f['oneof_index']<len(m['oneofs']) else '')
        print(' '*(ind+2)+'%s %s %s = %s;%s'%(f.get('label','optional'),t,f['name'],f['number'],oo))
    print(' '*ind+'}')
print('// %s  package %s  syntax %s'%(d['name'],d['package'],d['syntax']))
for e in d['enums']: emit_enum(e,0)
for m in d['messages']: emit_msg(m,0)
