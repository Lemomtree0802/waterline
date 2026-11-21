import { Engine as E } from './engine.js';
import { fixedScale, fillRatio } from './game.js';
import { LiquidMotion } from './motion.js';
import { compactWater } from './water-text.js';

let counter = 0;

// Describe only the action the player has just taken. No solution knowledge is
// needed: split groups and per-container changes come from the exact states.
export function feedbackForMove(level, before, info) {
  const next = info.next;
  const changedMask = before.mask ^ next.mask;
  const edge = Number.isInteger(info.edge) ? info.edge : level.e.findIndex((_, k) => changedMask & (1 << k));
  if (edge < 0 || edge >= level.e.length) return null;
  const opened = !!(next.mask & (1 << edge));
  const group = E.components(level.w.length, level.e, opened ? next.mask : before.mask)
    .find(nodes => nodes.includes(level.e[edge][0]));
  const parts = opened ? [group] : E.components(level.w.length, level.e, next.mask)
    .filter(nodes => nodes.some(i => group.includes(i)));
  const changes = group.map(node => {
    const amount = E.add(next.w[node], E.mul(E.F(-1), before.w[node]));
    const sign = E.cmp(amount, E.F(0));
    const magnitude = sign < 0 ? E.mul(E.F(-1), amount) : amount, exact = E.str(magnitude);
    const label = exact.length > 12 ? `≈${compactWater(magnitude)}` : exact;
    return { node, amount, sign, text: sign > 0 ? `+${label}` : sign < 0 ? `−${label}` : '不变' };
  });
  return { edge, opened, group, parts, changes };
}

function readGoal(level) {
  if (level.source === 'community' || level.source === 'draft') return null;
  const raw = level.goalWater ?? level.authorScore;
  if (raw == null) return null;
  try { return E.parse(raw); } catch { return null; }
}
export function positionsFor(level) {
  if (level.source === 'community' || level.source === 'draft') {
    if (level.pos?.length === level.w.length) return level.pos;
  }
  let positions = level.pos;
  if (!positions) {
    positions = Array.from({ length: level.w.length }, (_, i) => {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / level.w.length;
      return [400 + 270 * Math.cos(angle), 240 + 160 * Math.sin(angle)];
    });
  }
  const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), dx = Math.max(...xs) - minX, dy = Math.max(...ys) - minY;
  const gap = Math.min(...positions.flatMap((a, i) => positions.slice(i + 1).map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  const scale = Math.max(Math.min(dx ? 580 / dx : 1, dy ? 300 / dy : 1, 1.3), gap ? 104 / gap : 1);
  return positions.map(([x, y]) => [400 + (x - minX - dx / 2) * scale, 240 + (y - minY - dy / 2) * scale]);
}

export function viewBoxFor(positions, tight = false) {
  if (tight && positions.length) {
    const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
    return `${Math.min(...xs) - 85} ${Math.min(...ys) - 85} ${Math.max(...xs) - Math.min(...xs) + 170} ${Math.max(200, Math.max(...ys) - Math.min(...ys) + 170)}`;
  }
  const top = Math.min(0, ...positions.map(p => p[1] - 80));
  const bottom = Math.max(480, ...positions.map(p => p[1] + 80));
  const left = Math.min(0, ...positions.map(p => p[0] - 70));
  const right = Math.max(800, ...positions.map(p => p[0] + 70));
  return `${left} ${top} ${right - left} ${bottom - top}`;
}

// One SVG unit equals one screen pixel during play. Fit spacing, never the bottles.
export function playLayout(positions, width, height) {
  const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX, dy = maxY - minY;
  const distances = positions.flatMap((a, i) => positions.slice(i + 1).map(b => Math.hypot(a[0]-b[0], a[1]-b[1]))).filter(distance => distance > 0);
  const gap = Math.min(...distances), padding = 150;
  const fit = Math.min(1.35, dx ? Math.max(1, width-padding)/dx : Infinity, dy ? Math.max(1, height-padding)/dy : Infinity);
  const scale = Math.max(Number.isFinite(gap) ? 104/gap : 1, fit);
  const canvasWidth = Math.max(width, dx*scale+padding), canvasHeight = Math.max(height, dy*scale+padding);
  return {width:canvasWidth, height:canvasHeight, scale, positions:positions.map(([x,y]) => [canvasWidth/2+(x-(minX+maxX)/2)*scale, canvasHeight/2+(y-(minY+maxY)/2)*scale])};
}

// Keep the graph point at the viewport center in view when spacing and canvas
// size change. Scroll offsets alone describe pixels, not a point in the graph.
export function scrollForLayoutChange(before, after, scroll, previousViewport, viewport) {
  const ratio = after.scale / before.scale;
  return ['width', 'height'].map((axis, i) => {
    const oldCenter = scroll[i] + previousViewport[axis] / 2;
    const mappedCenter = after[axis] / 2 + (oldCenter - before[axis] / 2) * ratio;
    return Math.max(0, Math.min(Math.max(0, after[axis] - viewport[axis]), mappedCenter - viewport[axis] / 2));
  });
}

export function valvePositions(level, positions) {
  const used = [];
  return level.e.map(([a, b]) => {
    const p = positions[a], q = positions[b];
    let best, bestDistance = -1;
    for (const t of [.5, .38, .62, .28, .72]) {
      const candidate = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const distance = Math.min(...used.map(v => Math.hypot(candidate[0] - v[0], candidate[1] - v[1])), ...positions.map(v => Math.hypot(candidate[0] - v[0], candidate[1] - v[1]) - 20));
      if (distance > bestDistance) { best = candidate; bestDistance = distance; }
      if (t === .5 && distance >= 40) break;
    }
    used.push(best); return best;
  });
}

export class Graph {
  constructor(svg, level, { onValve, onNode, onDelete, editable = false, fixedNodes = false, showGoal = false } = {}) {
    this.svg = svg; this.level = level; this.onValve = onValve; this.onNode = onNode;
    this.editable = editable; this.onDelete = onDelete;
    this.fixedNodes = fixedNodes && !editable; this.basePositions = positionsFor(level);
    this.goal = null;
    this.positions = this.basePositions;
    if (this.fixedNodes) this.applyPlayLayout();
    this.valves = valvePositions(level, this.positions);
    this.scale = fixedScale(level); this.ratios = level.w.map(w => fillRatio(E.parseExact(w), this.scale));
    this.motion = new LiquidMotion(ratios => this.paint(ratios));
    this.prefix = `graph-${++counter}`;
    if (!this.fixedNodes) svg.setAttribute('viewBox', viewBoxFor(this.positions, !editable));
    svg.classList.toggle('dense-graph', level.w.length > 5);
    svg.innerHTML = `<defs>${this.positions.map(([x, y], i) => `<clipPath id="${this.prefix}-${i}"><circle cx="${x}" cy="${y}" r="32"/></clipPath>`).join('')}</defs><g class="pipes">${level.e.map(([a, b], k) => `<g data-pipe="${k}"><line class="pipe" x1="${this.positions[a][0]}" y1="${this.positions[a][1]}" x2="${this.positions[b][0]}" y2="${this.positions[b][1]}"/><line class="pipe-flow" x1="${this.positions[a][0]}" y1="${this.positions[a][1]}" x2="${this.positions[b][0]}" y2="${this.positions[b][1]}"/></g>`).join('')}</g><g class="valves">${level.e.map(([a, b], k) => `<g class="valve" data-valve="${k}" transform="translate(${this.valves[k].join(' ')})" role="button" tabindex="0"><title></title><circle class="valve-hit" r="24"/><circle class="valve-disc" r="13"/><path class="valve-handle" d="M-4 0H4"/></g>`).join('')}</g><g class="nodes">${this.positions.map(([x, y], i) => `<g class="water-node ${i === level.t ? 'target-node' : ''}" data-node="${i}" ${editable ? 'role="button" tabindex="0"' : 'role="img"'}><title></title><circle class="move-ring" cx="${x}" cy="${y}" r="47"/><circle class="node-base" cx="${x}" cy="${y}" r="34"/><g clip-path="url(#${this.prefix}-${i})"><rect class="water-fill" x="${x - 32}" width="64" y="${y + 32}" height="0"/><line class="water-surface" x1="${x - 32}" x2="${x + 32}" y1="${y + 32}" y2="${y + 32}"/><line class="goal-waterline" x1="${x - 32}" x2="${x + 32}" y1="${y}" y2="${y}"/></g><circle class="node-border" cx="${x}" cy="${y}" r="34"/><circle class="target-ring" cx="${x}" cy="${y}" r="42"/><text class="target-label" x="${x}" y="${y - 56}"></text><text class="node-number" x="${x}" y="${y + 6}"></text><text class="node-label" x="${x}" y="${y + 61}"></text><text class="move-label" x="${x}" y="${y + 80}"></text><text class="goal-status" x="${x + 36}" y="${y - 36}"></text></g>`).join('')}</g>`;
    this.nodeElements = [...svg.querySelectorAll('[data-node]')];
    this.valveElements = [...svg.querySelectorAll('[data-valve]')];
    this.pipeElements = [...svg.querySelectorAll('[data-pipe]')];
    svg.classList.toggle('has-goal', this.goal !== null);
    if (editable) {
      this.nodeElements.forEach((node, i) => {
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hit.setAttribute('class', 'node-hit'); hit.setAttribute('cx', this.positions[i][0]); hit.setAttribute('cy', this.positions[i][1]); hit.setAttribute('r', '45');
        node.prepend(hit);
      });
      this.pipeElements.forEach((pipe, k) => {
        pipe.setAttribute('role', 'button'); pipe.setAttribute('tabindex', '0');
        pipe.setAttribute('aria-label', `第 ${k+1} 条连线，点击选中`);
        const hit = pipe.querySelector('.pipe').cloneNode(); hit.setAttribute('class', 'pipe-hit'); pipe.prepend(hit);
      });
      this.selectionControls = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.selectionControls.setAttribute('class', 'selection-controls'); svg.append(this.selectionControls);
    }
    this.click = event => {
      if (event.target.closest('[data-editor-delete]')) { this.onDelete?.(); return; }
      const valve = event.target.closest('[data-valve]'), node = event.target.closest('[data-node]');
      if (valve) this.onValve?.(Number(valve.dataset.valve), event);
      if (node) this.onNode?.(Number(node.dataset.node), event);
      const pipe = event.target.closest('[data-pipe]');
      if (editable && pipe && !valve && !node) this.onValve?.(Number(pipe.dataset.pipe), event);
    };
    this.keydown = event => {
      if (!['Enter', ' '].includes(event.key) || !event.target.closest('[role="button"]')) return;
      event.preventDefault(); this.click(event);
    };
    svg.addEventListener('click', this.click); svg.addEventListener('keydown', this.keydown);
    this.preview = event => {
      if (this.editable || this.busy) return;
      const valve = event.target.closest('[data-valve]');
      if (valve) this.previewValve(Number(valve.dataset.valve));
    };
    this.endPreview = event => {
      if (event.relatedTarget?.closest?.('[data-valve]') === event.target.closest('[data-valve]')) return;
      this.clearPreview();
    };
    svg.addEventListener('pointerover', this.preview); svg.addEventListener('focusin', this.preview);
    svg.addEventListener('pointerout', this.endPreview); svg.addEventListener('focusout', this.endPreview);
    this.update(E.initial(level), false, false);
    this.resizeObserver = new ResizeObserver(() => this.fixedNodes ? this.resizePlayLayout() : this.updateTypography());
    this.resizeObserver.observe(this.fixedNodes ? svg.parentElement : svg);
    if (this.fixedNodes) this.centerTarget();
  }
  get busy() { return Boolean(this.motion.pending); }
  applyPlayLayout() {
    const viewport = this.svg.parentElement;
    // client sizes round to integer pixels; reserve one pixel so rounding never adds a scrollbar.
    const layout = playLayout(this.basePositions, Math.max(1,viewport.clientWidth-1), Math.max(1,viewport.clientHeight-1));
    this.playLayout = layout;
    this.viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight };
    this.positions = layout.positions;
    this.svg.style.width = `${layout.width}px`; this.svg.style.height = `${layout.height}px`;
    this.svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    viewport.tabIndex = layout.width > viewport.clientWidth+1 || layout.height > viewport.clientHeight+1 ? 0 : -1;
  }
  centerTarget() {
    const viewport = this.svg.parentElement, [x,y] = this.positions[this.level.t];
    viewport.scrollLeft = Math.max(0, x-viewport.clientWidth/2);
    viewport.scrollTop = Math.max(0, y-viewport.clientHeight/2);
  }
  resizePlayLayout() {
    const viewport = this.svg.parentElement;
    const previousLayout = this.playLayout, previousViewport = this.viewportSize;
    const scroll = [viewport.scrollLeft, viewport.scrollTop];
    this.applyPlayLayout(); this.valves = valvePositions(this.level, this.positions);
    this.nodeElements.forEach((node, i) => {
      const [x,y] = this.positions[i];
      [...node.querySelectorAll('circle'), this.svg.querySelector(`#${this.prefix}-${i} circle`)].forEach(circle => {circle.setAttribute('cx',x);circle.setAttribute('cy',y);});
      node.querySelector('.water-fill').setAttribute('x', x-32);
      const surface = node.querySelector('.water-surface'); surface.setAttribute('x1',x-32);surface.setAttribute('x2',x+32);
      node.querySelectorAll('text').forEach(text => text.setAttribute('x',x));
      node.querySelector('.target-label').setAttribute('y',y-56);node.querySelector('.node-label').setAttribute('y',y+61);
      node.querySelector('.move-label').setAttribute('y',y+80);
      node.querySelector('.goal-status').setAttribute('x',x+36);node.querySelector('.goal-status').setAttribute('y',y-36);
      const goal = node.querySelector('.goal-waterline'); goal.setAttribute('x1',x-32);goal.setAttribute('x2',x+32);
    });
    this.pipeElements.forEach((pipe,k) => {
      const [a,b] = this.level.e[k];
      pipe.querySelectorAll('line').forEach(line => {
        line.setAttribute('x1',this.positions[a][0]);line.setAttribute('y1',this.positions[a][1]);
        line.setAttribute('x2',this.positions[b][0]);line.setAttribute('y2',this.positions[b][1]);
      });
      this.valveElements[k].setAttribute('transform',`translate(${this.valves[k].join(' ')})`);
    });
    this.paint(this.ratios); this.updateTypography();
    const nextScroll = scrollForLayoutChange(previousLayout, this.playLayout, scroll, previousViewport, this.viewportSize);
    viewport.scrollLeft = nextScroll[0]; viewport.scrollTop = nextScroll[1];
  }
  paint(ratios) {
    this.ratios = ratios;
    this.nodeElements.forEach((node, i) => {
      const y = this.positions[i][1], h = 64 * ratios[i], surface = y + 32 - h;
      const rect = node.querySelector('.water-fill'), line = node.querySelector('.water-surface');
      rect.setAttribute('y', surface); rect.setAttribute('height', h);
      line.setAttribute('y1', surface); line.setAttribute('y2', surface); line.style.opacity = h > .05 ? '1' : '0';
      if (this.goal && i === this.level.t) {
        const goal = node.querySelector('.goal-waterline'), goalY = y + 32 - 64 * fillRatio(this.goal, this.scale);
        goal.setAttribute('y1', goalY); goal.setAttribute('y2', goalY);
      }
    });
  }
  updateTypography() {
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return;
    const scale = Math.hypot(matrix.a, matrix.b);
    if (!scale) return;
    this.nodeElements.forEach((node, i) => {
      const number = node.querySelector('.node-number'), length = number.textContent.length;
      const baseSize = length > 9 ? 11 : length > 6 ? 14 : length > 4 ? 18 : 26;
      // Keep short values readable on small screens while fitting longer fractions inside the node.
      const size = Math.min(40, 64 / (Math.max(1, length) * .6), Math.max(baseSize, 16 / scale));
      number.setAttribute('font-size', size);
      number.setAttribute('y', this.positions[i][1] + size * .35);
      node.querySelector('.node-label').style.fontSize = `${Math.max(16, 13 / scale)}px`;
      node.querySelector('.target-label').style.fontSize = `${Math.max(16, 13 / scale)}px`;
    });
    this.valveElements.forEach(valve => valve.querySelector('.valve-hit').setAttribute('r', Math.max(24, Math.min(48, 22 / scale))));
  }
  update(state, decimal = false, animate = true) {
    this.previousState = this.state ?? state; this.state = state;
    this.clearPreview();
    if (!animate) this.clearFeedback();
    const before = this.ratios.slice();
    const ratios = state.w.map(value => fillRatio(value, this.scale));
    this.nodeElements.forEach((node, i) => {
      const exact = E.str(state.w[i]), info = E.decimalInfo(state.w[i], 4);
      const full = decimal ? (info.exact ? '' : '≈') + info.text : exact;
      const text = full.length > 12 ? '≈' + compactWater(state.w[i]) : full;
      const number = node.querySelector('.node-number');
      number.textContent = text;
      node.setAttribute('aria-label', `${i===this.level.t?'红色圆圈':'绿色圆圈'}，水量 ${exact}`);
      node.querySelector('title').textContent = `精确水量 ${exact}`;
      if (this.goal && i === this.level.t) {
        const reached = E.cmp(state.w[i], this.goal) >= 0, goalText = E.str(this.goal);
        node.classList.toggle('has-reached-goal', reached);
        node.querySelector('.goal-status').textContent = reached ? '✓' : '';
        node.querySelector('.target-label').textContent = `目标 ${goalText.length > 10 ? '≈' + E.dec(this.goal, 3) : goalText}`;
        node.setAttribute('aria-label', `目标容器 ${i}，水量 ${exact}，目标水量 ${goalText}${reached ? '，已达到' : ''}`);
        node.querySelector('title').textContent += ` · 目标 ${goalText}${reached ? ' · 已达到' : ''}`;
      }
    });
    this.updateTypography();
    this.valveElements.forEach((valve, k) => {
      const open = !!(state.mask & (1 << k));
      valve.classList.toggle('is-open', open); this.pipeElements[k].classList.toggle('is-open', open);
      const [a, b] = this.level.e[k], moving = open && (before[a] !== ratios[a] || before[b] !== ratios[b]);
      this.pipeElements[k].classList.toggle('is-flowing', moving && (animate || Boolean(this.motion.pending)));
      const direction = before[a] - before[b] || (ratios[b] - before[b]) - (ratios[a] - before[a]);
      this.pipeElements[k].style.setProperty('--flow-offset', direction < 0 ? '34' : '-34');
      valve.setAttribute('aria-pressed', String(open));
      const label = this.editable ? `第 ${k+1} 条连线，点击选中` : `第 ${k+1} 个阀门，${open ? '已打开，点击关闭' : '已关闭，点击打开'}`;
      valve.setAttribute('aria-label', label); valve.querySelector('title').textContent = label;
    });
    const movement = this.motion.move(before, ratios, animate);
    this.svg.setAttribute('aria-busy', String(this.busy));
    return movement.then(settled => {
      if (settled) this.pipeElements.forEach(pipe => pipe.classList.remove('is-flowing'));
      this.svg.setAttribute('aria-busy', String(this.busy));
      return settled;
    });
  }
  previewValve(edge) {
    this.clearPreview();
    if (!this.state || !this.level.e[edge]) return;
    const info = E.inspectMove(this.level, this.state, edge);
    info.group.forEach(i => this.nodeElements[i].classList.add('preview-group'));
    this.pipeElements.forEach((pipe, k) => {
      const [a, b] = this.level.e[k];
      if (info.group.includes(a) && info.group.includes(b) && (this.state.mask & (1 << k) || k === edge)) pipe.classList.add('preview-group');
    });
    this.valveElements[edge].classList.add('is-previewed');
  }
  clearPreview() {
    this.nodeElements.forEach(node => node.classList.remove('preview-group'));
    this.pipeElements.forEach(pipe => pipe.classList.remove('preview-group'));
    this.valveElements.forEach(valve => valve.classList.remove('is-previewed'));
  }
  showMove(info) {
    this.clearFeedback();
    if (this.editable) return;
    const feedback = feedbackForMove(this.level, info.beforeState ?? this.previousState, info);
    if (!feedback) return;
    const { edge, opened, group, parts, changes } = feedback;
    this.valveElements[edge].classList.add('last-move');
    this.pipeElements[edge].classList.add('last-move');
    parts.forEach((nodes, part) => {
      nodes.forEach(i => {
        const node = this.nodeElements[i], change = changes.find(change => change.node === i);
        node.classList.add('move-group');
        node.classList.toggle('move-split', !opened);
        node.classList.toggle('water-gained', opened && change.sign > 0);
        node.classList.toggle('water-lost', opened && change.sign < 0);
        node.style.setProperty('--group-dash', `${part ? '3 5' : 'none'}`);
        node.querySelector('.move-label').textContent = opened && change.sign !== 0 ? change.text : '';
      });
    });
    this.pipeElements.forEach((pipe, k) => {
      const [a, b] = this.level.e[k];
      if (group.includes(a) && group.includes(b) && info.next.mask & (1 << k)) pipe.classList.add('move-group');
    });
    this.feedbackTimer = setTimeout(() => this.clearFeedback(), 1800);
  }
  clearFeedback() {
    clearTimeout(this.feedbackTimer); this.feedbackTimer = null;
    this.nodeElements.forEach(node => {
      node.classList.remove('move-group', 'move-split', 'water-gained', 'water-lost');
      node.querySelector('.move-label').textContent = '';
    });
    this.pipeElements.forEach(pipe => pipe.classList.remove('move-group', 'last-move'));
    this.valveElements.forEach(valve => valve.classList.remove('last-move'));
  }
  highlight(nodes) {
    this.nodeElements.forEach((node, i) => {
      node.classList.toggle('is-selected', nodes.includes(i));
      if (this.editable) node.setAttribute('aria-pressed', String(nodes.includes(i)));
    });
  }
  highlightEdge(edge) {
    this.pipeElements.forEach((pipe, k) => pipe.classList.toggle('is-selected', k === edge));
    this.valveElements.forEach((valve, k) => {
      valve.classList.toggle('is-selected', k === edge);
      if (this.editable) valve.setAttribute('aria-pressed', String(k === edge));
    });
  }
  showDeleteControl([x, y], label) {
    if (!this.selectionControls) return;
    const action = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    action.setAttribute('data-editor-delete', ''); action.setAttribute('role', 'button'); action.setAttribute('tabindex', '0');
    action.setAttribute('aria-label', label); action.setAttribute('transform', `translate(${x + 40} ${y - 38})`);
    action.innerHTML = '<circle class="delete-hit" r="22"/><circle class="delete-disc" r="13"/><path class="delete-cross" d="M-4 -4 4 4M-4 4 4 -4"/>';
    this.selectionControls.replaceChildren(action);
  }
  destroy() {
    this.motion.cancel(); this.clearFeedback(); this.clearPreview(); this.resizeObserver?.disconnect();
    this.svg.removeEventListener('click', this.click); this.svg.removeEventListener('keydown', this.keydown);
    this.svg.removeEventListener('pointerover', this.preview); this.svg.removeEventListener('focusin', this.preview);
    this.svg.removeEventListener('pointerout', this.endPreview); this.svg.removeEventListener('focusout', this.endPreview);
  }
}

export function graphThumbnail(level) {
  const positions = positionsFor(level), scale = fixedScale(level), prefix = `preview-${++counter}`;
  const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
  const box = [Math.min(...xs) - 85, Math.min(...ys) - 75, Math.max(...xs) - Math.min(...xs) + 170, Math.max(...ys) - Math.min(...ys) + 150];
  return `<svg class="graph-thumbnail" viewBox="${box.join(' ')}" aria-hidden="true"><defs>${positions.map(([x, y], i) => `<clipPath id="${prefix}-${i}"><circle cx="${x}" cy="${y}" r="44"/></clipPath>`).join('')}</defs>${level.e.map(([a, b]) => `<line x1="${positions[a][0]}" y1="${positions[a][1]}" x2="${positions[b][0]}" y2="${positions[b][1]}" stroke="#c4d5cc" stroke-width="6"/>`).join('')}${positions.map(([x, y], i) => {
    const height = 88 * fillRatio(E.parseExact(level.w[i]), scale), target = i === level.t;
    const value = E.str(E.parseExact(level.w[i])), label = value.length > 8 ? '…' : value;
    return `<g><circle cx="${x}" cy="${y}" r="44" fill="#fffefa"/><rect x="${x - 44}" y="${y + 44 - height}" width="88" height="${height}" fill="${target ? '#eed6c4' : '#c4e1cd'}" clip-path="url(#${prefix}-${i})"/><circle cx="${x}" cy="${y}" r="44" fill="none" stroke="${target ? '#bd7762' : '#9fb69e'}" stroke-width="2"/>${target ? `<circle cx="${x}" cy="${y}" r="53" fill="none" stroke="#bd7762" stroke-dasharray="3 5"/>` : ''}<text x="${x}" y="${y + 11}" class="preview-number" font-size="${label.length > 4 ? 24 : 36}">${label}</text></g>`;
  }).join('')}</svg>`;
}
