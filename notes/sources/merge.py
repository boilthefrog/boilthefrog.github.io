import json,re,unicodedata,glob
def norm(t):
    t=unicodedata.normalize('NFKD',t).encode('ascii','ignore').decode().lower()
    t=t.replace('&','and'); t=re.sub(r'^(the|a|an) ','',t); return re.sub(r'[^a-z0-9]','',t)
films={}; order=[]
def add(t,y,src):
    k=norm(t)
    for (kk,yy) in list(films):
        if kk==k and abs(yy-y)<=1: films[(kk,yy)]['src'].add(src); return
    films[(k,y)]={'t':t,'y':y,'src':{src}}; order.append((k,y))
sec=None
for line in open('raw.txt'):
    line=line.strip()
    if not line: continue
    if line.startswith('#'): sec=line[1:]; continue
    t,y=line.rsplit('|',1); add(t,int(y),'Taschen' if sec.startswith('T') else {'S':'Scorsese','I':'IMDb'}[sec])
onsite={}
for f in glob.glob('/home/claude/boilthefrog.github.io/data/*.json'):
    d=json.load(open(f)); L=d['title']
    for c in d['core']:
        onsite.setdefault((norm(c['t']),c['y']),[]).append(f"{L} core")
        for b in c['br']+c['seq']: onsite.setdefault((norm(b['t']),b['y']),[]).append(f"{L} side")
    for b in d['beyond']: onsite.setdefault((norm(b['t']),b['y']),[]).append(f"{L} beyond")
rows=[]
for key in order:
    f=films[key]; site=[]
    for (k,y),v in onsite.items():
        if k==key[0] and abs(y-key[1])<=1: site+=v
    rows.append(dict(t=f['t'],y=f['y'],src=' + '.join(s for s in ['Taschen','Scorsese','IMDb'] if s in f['src']),site='; '.join(sorted(set(site)))))
rows.sort(key=lambda r:(r['y'],r['t']))
json.dump(rows,open('merged.json','w'),ensure_ascii=False,indent=0)
print(len(rows), sum(1 for r in rows if r['site']))
