// Keep one navigation in flight; newer destinations replace queued ones.
export class SceneTransitions {
  constructor({ cover, reveal, lock, unlock }) {
    this.cover = cover; this.reveal = reveal; this.lock = lock; this.unlock = unlock;
    this.serial = 0; this.busy = false; this.pending = null;
  }
  run({ prepare = () => {}, mount, onError = () => {}, animate = true }) {
    return new Promise(resolve => {
      this.pending?.resolve(false);
      this.pending = { prepare, mount, onError, animate, resolve, id: ++this.serial };
      if (!this.busy) void this.drain();
    });
  }
  async drain() {
    this.busy = true;
    try {
      this.lock();
      while (this.pending) {
        const job = this.pending; this.pending = null;
        try {
          await this.cover(job.animate);
          await job.prepare();
          if (job.id !== this.serial) { job.resolve(false); continue; }
          const mounted = job.mount() !== false;
          await this.reveal(job.animate);
          job.resolve(mounted && job.id === this.serial);
        } catch (error) {
          if (job.id === this.serial) {
            try { job.onError(error); } catch { /* Always release navigation controls. */ }
            await this.reveal(false).catch(() => {});
          }
          job.resolve(false);
        }
      }
    } finally {
      this.unlock(); this.busy = false;
    }
  }
}

export function createSceneTransitions({ main, header, footer, curtain, body = document.body,
  reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches }) {
  const surfaces = [main, header, footer].filter(Boolean);
  let covered = false, animations = [];
  const clearAnimations = () => { animations.forEach(animation => animation.cancel()); animations = []; };
  const play = (element, frames, duration) => {
    if (!element.animate) return Promise.resolve();
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards' });
    animations.push(animation);
    return animation.finished.catch(() => {});
  };
  const restore = () => {
    clearAnimations(); curtain.hidden = true; curtain.style.opacity = '0'; covered = false;
    delete body.dataset.transition;
  };
  return new SceneTransitions({
    lock() {
      surfaces.forEach(surface => { surface.inert = true; });
      main.setAttribute('aria-busy', 'true');
    },
    async cover(animate) {
      if (!animate || reduced() || covered) return;
      curtain.hidden = false; curtain.style.opacity = '0'; body.dataset.transition = 'leaving';
      await play(curtain, [{opacity: 0}, {opacity: 1}], 190);
      curtain.style.opacity = '1'; clearAnimations(); covered = true;
    },
    async reveal(animate) {
      if (covered && animate && !reduced()) {
        body.dataset.transition = 'entering';
        await Promise.all([
          play(curtain, [{opacity: 1}, {opacity: 0}], 260),
          play(main, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0)'}], 300),
        ]);
      }
      restore();
    },
    unlock() {
      restore(); surfaces.forEach(surface => { surface.inert = false; });
      main.removeAttribute('aria-busy');
    },
  });
}
