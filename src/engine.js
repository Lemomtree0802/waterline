export function createEngine(){
'use strict';
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b]}return a<0n?-a:a};
const F=(n,d=1n)=>{n=BigInt(n);d=BigInt(d);if(!d)throw Error('分母不能为 0');if(d<0n){n=-n;d=-d}const g=gcd(n,d);return {n:n/g,d:d/g}};
const add=(a,b)=>F(a.n*b.d+b.n*a.d,a.d*b.d),mul=(a,b)=>F(a.n*b.n,a.d*b.d),div=(a,k)=>F(a.n,a.d*BigInt(k)),cmp=(a,b)=>{const x=a.n*b.d-b.n*a.d;return x<0n?-1:x>0n?1:0},str=a=>a.d===1n?String(a.n):a.n+'/'+a.d;
// Official research puzzles contain large exact integers. User-created water
// still goes through parse(), retaining the original workshop input limits.
function parseExact(s){s=String(s).trim();if(s.length>4096||!/^\d+(?:\.\d{1,9}|\/\d+)?$/.test(s))throw Error('水量须为非负整数、小数（最多 9 位）或分数，例如 3/4');if(s.includes('/')){const[n,d]=s.split('/');return F(n,d)}const[n,d='']=s.split('.');return F(n+d,10n**BigInt(d.length))}
function parse(s){if(String(s).trim().length>80)throw Error('初始水量过长');const f=parseExact(s);if(cmp(f,F(1000000000))>0)throw Error('初始水量不能超过 10 亿');return f}
function dec(a,places=4){const sign=a.n<0n?'-':'';let n=a.n<0n?-a.n:a.n;const pow=10n**BigInt(places);const r=(n*pow*2n+a.d)/(2n*a.d);let s=String(r/pow);if(places){let tail=String(r%pow).padStart(places,'0').replace(/0+$/,'');if(tail)s+='.'+tail}return sign+s}
const sum=xs=>xs.reduce(add,F(0));
function decimalInfo(a,places=6){return {text:dec(a,places),exact:(10n**BigInt(places))%a.d===0n}}
function energy(w){const total=sum(w);return add(sum(w.map(x=>mul(x,x))),mul(F(-1,w.length),mul(total,total)))}
function inspectMove(p,s,k){const next=move(p,s,k),opened=!!(next.mask&(1<<k)),group=components(s.w.length,p.e,opened?next.mask:s.mask).find(c=>c.includes(p.e[k][0]));return {next,opened,group,total:sum(group.map(i=>s.w[i])),mean:div(sum(group.map(i=>s.w[i])),group.length),delta:add(next.w[p.t],mul(F(-1),s.w[p.t])),before:energy(s.w),after:energy(next.w)}}
function components(n,edges,mask){const p=Array.from({length:n},(_,i)=>i);const root=i=>{while(p[i]!==i){p[i]=p[p[i]];i=p[i]}return i};edges.forEach(([a,b],i)=>{if(mask&(1<<i))p[root(a)]=root(b)});const groups=new Map();for(let i=0;i<n;i++){let r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i)}return [...groups.values()]}
function validatePuzzle(raw,maxVertices,parseWater){if(!raw||typeof raw!=='object'||!Array.isArray(raw.w)||raw.w.length<2||raw.w.length>maxVertices)throw Error(`需要 2–${maxVertices} 个顶点`);const w=raw.w.map(x=>str(parseWater(x))),n=w.length;if(!Number.isInteger(raw.t)||raw.t<0||raw.t>=n)throw Error('目标顶点编号超出范围');if(!Array.isArray(raw.e)||raw.e.length<1||raw.e.length>16)throw Error('需要 1–16 条边');const seen=new Set();const e=raw.e.map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('每条边应包含两个编号');let[a,b]=pair;if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=n||b>=n||a===b)throw Error('边的顶点编号无效，不能连接自身');if(a>b)[a,b]=[b,a];const k=a+'-'+b;if(seen.has(k))throw Error('不能有重复边');seen.add(k);return[a,b]}).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(components(n,e,(1<<e.length)-1).length!==1)throw Error('所有顶点必须连通');return {id:typeof raw.id==='string'?raw.id.slice(0,40):'custom',name:typeof raw.name==='string'?raw.name.slice(0,40):'自定义关卡',w,t:raw.t,e}}
const validate=raw=>validatePuzzle(raw,10,parse),validateOfficial=raw=>validatePuzzle(raw,12,parseExact);
const key=p=>JSON.stringify([p.w.map(x=>str(parseExact(x))),p.e,p.t]);
const initial=p=>({w:p.w.map(parseExact),mask:0});
function move(p,s,k){if(!Number.isInteger(k)||k<0||k>=p.e.length)throw Error('无效阀门');const mask=s.mask^(1<<k),w=s.w.slice();if(mask&(1<<k)){for(const c of components(w.length,p.e,mask)){if(c.length<2)continue;const a=div(sum(c.map(i=>w[i])),c.length);for(const i of c)w[i]=a}}return {w,mask}}
function replay(p,seq){if(!Array.isArray(seq))throw Error('操作序列必须是数组');const frames=[initial(p)];for(const k of seq)frames.push(move(p,frames.at(-1),k));return frames}
function distances(p){const d=p.w.map(()=>Infinity);d[p.t]=0;const q=[p.t];for(const v of q)for(const[a,b]of p.e){const u=a===v?b:b===v?a:-1;if(u>=0&&d[u]===Infinity){d[u]=d[v]+1;q.push(u)}}return d}
// Proposition 3.5 / Appendix B of Sharing tea on a graph. This is an upper bound, not a solver.
function upper(p,w){const d=distances(p);let z=w[p.t];const ids=w.map((_,i)=>i).filter(i=>cmp(w[i],z)>0).sort((a,b)=>cmp(w[a],w[b]));for(const i of ids)z=div(add(mul(F(d[i]),z),w[i]),d[i]+1);return z}
function theorem(p){const n=p.w.length,adj=Array.from({length:n},()=>[]);for(const[a,b]of p.e){adj[a].push(b);adj[b].push(a)}const w=p.w.map(parse);if(p.e.length===n-1&&adj[p.t].length===n-1){let v=w[p.t];for(const a of w.filter((x,i)=>i!==p.t&&cmp(x,v)>0).sort(cmp))v=div(add(v,a),2);return{score:v,kind:'星形图定理',source:'https://arxiv.org/html/2405.15353v2#S3'}}
if(p.e.length!==n-1||adj.some(x=>x.length>2))return null;let order=[adj.findIndex(x=>x.length===1)];while(order.length<n){const prev=order.at(-2),v=order.at(-1);order.push(adj[v].find(u=>u!==prev))}let best=w[p.t];for(let flip=0;flip<2;flip++){const ws=order.map(i=>w[i]),v=order.indexOf(p.t);for(let l=0;l<=v;l++)for(let r=v;r<n;r++)for(let q=v;q<=r;q++){let z;if(q===l)z=div(sum(ws.slice(l,r+1)),r-l+1);else z=add(mul(F(q-v, (q-l)*(r-v+1)),sum(ws.slice(l,q))),div(sum(ws.slice(q,r+1)),r-v+1));if(cmp(z,best)>0)best=z}order.reverse()}return{score:best,kind:'路径图最优公式',source:'https://arxiv.org/html/2501.16911v1#S4.SS4'}}
function certificate(p,seq){const t=theorem(p);if(t)return t;if(Array.isArray(seq)){const score=replay(p,seq).at(-1).w[p.t],ub=upper(p,p.w.map(parse));if(cmp(score,ub)===0)return {score,kind:'上界与可达方案相等',source:'https://arxiv.org/html/2405.15353v2#S3'}}return null}
function importRun(data){if(data?.schema!=='waterline-run-v1')throw Error('文件不是水衡成绩记录');const p=validate(data.puzzle),frames=replay(p,data.moves),score=str(frames.at(-1).w[p.t]);if(data.score!==score||data.ops!==data.moves.length)throw Error('记录校验失败：成绩或步数与重放不一致');return{p,frames,moves:data.moves.slice(),assisted:data.assisted!==false}}
return {decimalInfo,energy,inspectMove,F,add,mul,div,cmp,str,parse,parseExact,dec,sum,components,validate,validateOfficial,key,initial,move,replay,distances,upper,theorem,certificate,importRun};
}

export const Engine = createEngine();
