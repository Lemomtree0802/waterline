export const WATER_FLOW_MS = 240;

// Equalization is one discrete action. Paint its exact result immediately, then
// keep a short presentation interval so the connection flash can be read.
export class LiquidMotion {
  constructor(paint, { request = callback => requestAnimationFrame(callback), cancel = id => cancelAnimationFrame(id),
    now = () => performance.now(), reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
    this.paint = paint; this.request = request; this.cancelFrame = cancel; this.now = now; this.reduced = reduced;
  }
  move(before, after, animate = true) {
    if (animate && this.pending && after.every((value, i) => value === this.destination[i])) return this.pending.promise;
    this.cancel();
    this.destination = after.slice();
    this.paint(after);
    if (!animate || this.reduced() || after.every((value, i) => value === before[i])) {
      return Promise.resolve(true);
    }
    const start = this.now();
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    this.pending = {promise, resolve};
    const frame = time => {
      if (time - start < WATER_FLOW_MS) this.frame = this.request(frame);
      else { this.pending = null; this.frame = null; resolve(true); }
    };
    this.frame = this.request(frame);
    return promise;
  }
  cancel() {
    if (this.frame != null) this.cancelFrame(this.frame);
    this.pending?.resolve(false); this.pending = null; this.frame = null;
  }
}

export function createCompletionPulse(layer) {
  let active;
  const clear = () => { active?.cancel(); active = null; layer.hidden = true; layer.replaceChildren(); };
  return {
    clear,
    play(node) {
      clear();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = node.querySelector('.node-border').getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, radius = rect.width / 2 + 6;
      const reach = Math.max(...[[0,0],[innerWidth,0],[0,innerHeight],[innerWidth,innerHeight]].map(([a,b]) => Math.hypot(a-x,b-y))) + radius;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
      const ring = document.createElementNS(svg.namespaceURI, 'circle');
      ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', radius);
      ring.setAttribute('vector-effect', 'non-scaling-stroke');
      ring.style.transformOrigin = `${x}px ${y}px`;
      svg.append(ring); layer.append(svg); layer.hidden = false;
      const animation = ring.animate([
        {transform: 'scale(1)', opacity: 0},
        {transform: 'scale(1.12)', opacity: .65, offset: .08},
        {transform: `scale(${reach / radius})`, opacity: 0},
      ], {duration: 1500, easing: 'cubic-bezier(.25,.1,.3,1)', fill: 'forwards'});
      active = animation;
      animation.finished.catch(() => {}).then(() => { if (active === animation) clear(); });
    },
  };
}
