let sequence=0;
export class SubmissionGuide {
  constructor({valve,node,submit}) {
    this.valve=valve;this.node=node;this.submit=submit;this.stage='valve';
    this.layer=document.createElement('div');this.layer.className='submission-guide';
    this.layer.innerHTML='<svg aria-hidden="true"><path fill-rule="evenodd"/></svg><p role="status"></p>';
    this.layer.dataset.guide=String(++sequence);document.body.append(this.layer);
    this.update=()=>this.draw();this.escape=event=>{if(event.key==='Escape')this.destroy();};
    window.addEventListener('resize',this.update);document.addEventListener('scroll',this.update,true);document.addEventListener('keydown',this.escape);
    this.observer=new ResizeObserver(this.update);this.observer.observe(submit);this.observer.observe(valve.ownerSVGElement);
    this.draw();
  }
  draw() {
    if(!this.layer?.isConnected)return;
    const width=window.innerWidth,height=window.innerHeight;
    const circle=element=>{const r=element.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,radius=Math.max(r.width,r.height)/2+8;return `M${x-radius},${y}a${radius},${radius} 0 1,0 ${radius*2},0a${radius},${radius} 0 1,0 ${-radius*2},0Z`;};
    let path=`M0,0H${width}V${height}H0Z`;
    if(this.stage==='valve')path+=circle(this.valve)+circle(this.node);
    else {const r=this.submit.getBoundingClientRect(),p=8;path+=`M${r.left-p},${r.top-p}H${r.right+p}V${r.bottom+p}H${r.left-p}Z`;}
    this.layer.querySelector('svg').setAttribute('viewBox',`0 0 ${width} ${height}`);
    this.layer.querySelector('path').setAttribute('d',path);
    const target=this.stage==='valve'?this.valve:this.submit,r=target.getBoundingClientRect();
    const note=this.layer.querySelector('p');note.textContent=this.stage==='valve'?'想办法通过开关阀门，让红圈中的数字尽可能大':'当你觉得已经达到最好成绩时，请点击提交成绩按钮';
    const noteWidth=note.offsetWidth,noteHeight=note.offsetHeight;
    note.style.left=`${Math.max(20+noteWidth/2,Math.min(width-20-noteWidth/2,(r.left+r.right)/2))}px`;
    note.style.top=`${Math.max(24,Math.min(height-noteHeight-24,r.top-noteHeight-24))}px`;
  }
  advance(){if(!this.layer?.isConnected)return;this.stage='submit';this.submit.scrollIntoView({block:'nearest',behavior:'instant'});this.draw();this.submit.focus({preventScroll:true});}
  pause(){if(this.layer)this.layer.hidden=true;}
  resume(){if(this.layer){this.layer.hidden=false;this.draw();}}
  destroy(){this.stage='done';this.observer?.disconnect();window.removeEventListener('resize',this.update);document.removeEventListener('scroll',this.update,true);document.removeEventListener('keydown',this.escape);this.layer?.remove();}
}
