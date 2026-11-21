import { Engine as E } from './engine.js';

// A playable wordmark. Its network has independent valves instead of the
// puzzle engine's bounded bit mask, so every letter can contain several nodes.
export function wordmarkNetwork(random = Math.random) {
  const glyphs=[
    [[[0,0],[.2,1],[.5,.45],[.8,1],[1,0]],[[0,1],[1,2],[2,3],[3,4]]],
    [[[0,1],[.5,0],[1,1],[.23,.55],[.77,.55]],[[0,3],[3,1],[1,4],[4,2],[3,4]]],
    [[[0,0],[.5,0],[1,0],[.5,.5],[.5,1]],[[0,1],[1,2],[1,3],[3,4]]],
    [[[1,0],[0,0],[0,.5],[.8,.5],[0,1],[1,1]],[[0,1],[1,2],[2,3],[2,4],[4,5]]],
    [[[0,1],[0,.5],[0,0],[1,0],[1,.5],[.55,.5],[1,1]],[[0,1],[1,2],[2,3],[3,4],[4,5],[5,1],[5,6]]],
    [[[0,0],[0,.5],[0,1],[1,1]],[[0,1],[1,2],[2,3]]],
    [[[.5,0],[.5,.5],[.5,1]],[[0,1],[1,2]]],
    [[[0,1],[0,0],[.5,.5],[1,1],[1,0]],[[0,1],[1,2],[2,3],[3,4]]],
    [[[1,0],[0,0],[0,.5],[.8,.5],[0,1],[1,1]],[[0,1],[1,2],[2,3],[2,4],[4,5]]],
  ];
  const nodes=[],edges=[];
  glyphs.forEach(([points,links],letter)=>{
    const offset=nodes.length;
    points.forEach(([x,y])=>nodes.push({letter,x,y,water:E.F(1+Math.floor(random()*9))}));
    links.forEach(([a,b])=>edges.push([a+offset,b+offset]));
  });
  return {nodes,edges,open:edges.map(()=>false)};
}

export function toggleWordmark(network,edge) {
  network.open[edge]=!network.open[edge];
  if(!network.open[edge])return;
  const {nodes,edges,open}=network,seen=new Set([edges[edge][0]]),queue=[edges[edge][0]];
  for(const node of queue)edges.forEach(([a,b],i)=>{
    if(!open[i])return;
    const other=a===node?b:b===node?a:null;
    if(other!==null&&!seen.has(other)){seen.add(other);queue.push(other);}
  });
  const total=queue.reduce((sum,i)=>E.add(sum,nodes[i].water),E.F(0));
  const average=E.mul(total,E.F(1,queue.length));
  queue.forEach(i=>{nodes[i].water=average;});
}

let unique=0;
export class HomeWordmark {
  constructor(svg) {
    this.svg=svg;this.network=wordmarkNetwork();this.prefix='wordmark-'+(++unique);
    this.resize=()=>this.render();
    this.observer=new ResizeObserver(this.resize);this.observer.observe(svg);
    this.click=event=>{
      const valve=event.target.closest('[data-letter-valve]');if(!valve)return;
      toggleWordmark(this.network,Number(valve.dataset.letterValve));this.paint();
    };
    this.key=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click(event);}};
    svg.addEventListener('click',this.click);svg.addEventListener('keydown',this.key);this.render();
  }
  render() {
    const compact=this.svg.clientWidth<700;
    const points=this.network.nodes.map(node=>{
      const row=compact&&node.letter>=5?1:0,col=row?node.letter-5:node.letter;
      return [35+col*112+node.x*68+(row?56:0),35+row*180+node.y*112];
    });
    this.svg.setAttribute('viewBox',compact?'0 0 585 355':'0 0 1035 185');
    this.svg.innerHTML=`<defs>${points.map(([x,y],i)=>`<clipPath id="${this.prefix}-${i}"><circle cx="${x}" cy="${y}" r="10"/></clipPath>`).join('')}</defs>
      <g class="letter-pipes">${this.network.edges.map(([a,b],i)=>`<line data-letter-pipe="${i}" x1="${points[a][0]}" y1="${points[a][1]}" x2="${points[b][0]}" y2="${points[b][1]}"/>`).join('')}</g>
      ${this.network.edges.map(([a,b],i)=>`<g role="button" tabindex="0" data-letter-valve="${i}" transform="translate(${(points[a][0]+points[b][0])/2} ${(points[a][1]+points[b][1])/2})"><circle class="letter-valve-hit" r="20"/><circle class="letter-valve-disc" r="6"/><path d="M-3 0H3"/></g>`).join('')}
      <g>${points.map(([x,y],i)=>`<g class="letter-water-node" data-letter-node="${i}"><title></title><circle class="letter-node-base" cx="${x}" cy="${y}" r="11"/><g clip-path="url(#${this.prefix}-${i})"><rect class="letter-water" x="${x-10}" y="${y+10}" width="20" height="0"/></g><circle class="letter-node-border" cx="${x}" cy="${y}" r="11"/></g>`).join('')}</g>`;
    this.points=points;this.paint();
  }
  paint() {
    this.svg.querySelectorAll('[data-letter-node]').forEach((node,i)=>{
      const height=20*Number(E.dec(this.network.nodes[i].water,5))/10;
      const water=node.querySelector('rect');water.setAttribute('height',height);water.setAttribute('y',this.points[i][1]+10-height);
      node.querySelector('title').textContent='水量 '+E.str(this.network.nodes[i].water);
    });
    this.svg.querySelectorAll('[data-letter-valve]').forEach((valve,i)=>{
      valve.classList.toggle('is-open',this.network.open[i]);valve.setAttribute('aria-pressed',String(this.network.open[i]));
      valve.setAttribute('aria-label',`字形阀门 ${i+1}，${this.network.open[i]?'点击关闭':'点击打开'}`);
      this.svg.querySelector(`[data-letter-pipe="${i}"]`).classList.toggle('is-open',this.network.open[i]);
    });
  }
  destroy(){this.observer.disconnect();this.svg.removeEventListener('click',this.click);this.svg.removeEventListener('keydown',this.key);}
}
