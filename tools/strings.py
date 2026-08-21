import sys, re
path, out, minlen = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv)>3 else 5
data = open(path,'rb').read()
pat = re.compile(rb'[\x20-\x7e]{%d,}' % minlen)
with open(out,'w',encoding='utf-8',errors='replace') as f:
    for m in pat.finditer(data):
        f.write('%08x A %s\n' % (m.start(), m.group().decode('ascii')))
    pat16 = re.compile(rb'(?:[\x20-\x7e]\x00){%d,}' % minlen)
    for m in pat16.finditer(data):
        f.write('%08x U %s\n' % (m.start(), m.group().decode('utf-16-le')))
print(len(data))
