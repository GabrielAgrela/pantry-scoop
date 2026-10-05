// Classic (non-module) script loaded in <head> so a saved theme applies before first paint.
// No saved choice means the page follows the system setting via prefers-color-scheme.
(() => {
  const KEY = 'pantry-scoop-theme';
  const root = document.documentElement;
  const systemDark = matchMedia('(prefers-color-scheme: dark)');

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: follow the system */ }
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);

  function sync() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
    const button = document.querySelector('.theme-toggle');
    if (button) button.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
  }

  // Clip the old snapshot once, then move that clip across the screen. Counter-translating
  // its contents keeps the page still while the new snapshot appears underneath. Only transforms
  // animate: a changing full-screen polygon otherwise needs new clipping work on every frame.
  function waveGeometry() {
    const w = innerWidth, h = innerHeight, len = Math.hypot(w, h);
    const nx = h / len, ny = w / len; // unit normal of the front, pointing towards bottom-right
    const tx = -ny, ty = nx;          // unit tangent along the front
    const amp = Math.min(w, h) * 0.04 + 12, k = (2 * Math.PI) / Math.max(180, len / 5);
    // The front only needs to span the screen's projection onto it, plus room for the swell.
    const from = -(w * w) / len - amp * 2, to = (h * h) / len + amp * 2;
    const points = Math.ceil((to - from) / 10), ahead = len * 2;
    const start = -amp * 2, travel = (2 * w * h) / len + amp * 4; // old theme fully covers at 0, fully clears at 1
    const edge = Array.from({ length: points + 1 }, (_, i) => {
      const s = from + ((to - from) * i) / points;
      const d = start + amp * (Math.sin(k * s) + 0.35 * Math.sin(2.3 * k * s));
      return [nx * d + tx * s, ny * d + ty * s];
    });
    const [first, last] = [edge[0], edge[points]];
    edge.push([last[0] + nx * ahead, last[1] + ny * ahead], [first[0] + nx * ahead, first[1] + ny * ahead]);
    return {
      clip: `polygon(${edge.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`,
      x: nx * travel, y: ny * travel,
    };
  }

  function setTheme(next) {
    root.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* still applies for this visit */ }
    sync();
    document.dispatchEvent(new CustomEvent('themeswitch', { detail: { dark: next === 'dark' } }));
  }

  /** The toggle's icon does a little flip: the moon swings in, the sun spins up. */
  function popIcon(dark) {
    const icon = document.querySelector(dark ? '.theme-toggle .theme-icon-light' : '.theme-toggle .theme-icon-dark');
    if (!icon?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    icon.animate(dark
      ? [{ transform: 'rotate(-120deg) scale(.3)', opacity: 0 }, { transform: 'rotate(12deg) scale(1.2)', opacity: 1, offset: 0.65 }, { transform: 'none' }]
      : [{ transform: 'rotate(-180deg) scale(.3)', opacity: 0 }, { transform: 'rotate(20deg) scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'none' }],
    { duration: 650, easing: 'cubic-bezier(.3, 1.4, .5, 1)' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('.theme-toggle');
    button?.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      popIcon(next === 'dark');
      if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTheme(next);
      const wave = waveGeometry();
      button.disabled = true;
      const previousName = document.body.style.viewTransitionName;
      // Separate names give the old clipped snapshot and the new full snapshot their own groups.
      document.body.style.viewTransitionName = 'theme-old';
      root.style.setProperty('--theme-wave-clip', wave.clip);
      root.classList.add('theme-wave');
      const transition = document.startViewTransition(() => {
        document.body.style.viewTransitionName = 'theme-new';
        setTheme(next);
      });
      transition.ready.then(() => {
        const timing = { duration: 900, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'forwards' };
        root.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${wave.x}px, ${wave.y}px)` }],
          { ...timing, pseudoElement: '::view-transition-group(theme-old)' });
        root.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${-wave.x}px, ${-wave.y}px)` }],
          { ...timing, pseudoElement: '::view-transition-image-pair(theme-old)' });
      }).catch(() => {});
      const cleanup = () => {
        root.classList.remove('theme-wave');
        root.style.removeProperty('--theme-wave-clip');
        document.body.style.viewTransitionName = previousName;
        button.disabled = false;
      };
      transition.finished.then(cleanup, cleanup);
    });
    sync();
  });
  systemDark.addEventListener('change', sync);
})();
