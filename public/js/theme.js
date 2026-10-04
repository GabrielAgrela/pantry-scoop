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

  // A rippling wave front, perpendicular to the screen diagonal, that sweeps the new theme in
  // from the top-left corner to the bottom-right. Returns clip-path keyframes for the new snapshot.
  function waveFrames() {
    const w = innerWidth, h = innerHeight, len = Math.hypot(w, h);
    const nx = h / len, ny = w / len; // unit normal of the front, pointing towards bottom-right
    const tx = -ny, ty = nx;          // unit tangent along the front
    const amp = Math.min(w, h) * 0.04 + 12, k = (2 * Math.PI) / Math.max(180, len / 5);
    // The front only needs to span the screen's projection onto it, plus room for the swell.
    const from = -(w * w) / len - amp * 2, to = (h * h) / len + amp * 2;
    const points = Math.ceil((to - from) / 10), frames = 36, behind = len * 2;
    const start = -amp * 2, travel = (2 * w * h) / len + amp * 4; // fully hidden at 0, fully covering at 1
    return Array.from({ length: frames + 1 }, (_, f) => {
      const p = f / frames;
      const r = start + travel * p;
      const swell = amp * (Math.sin(Math.PI * p) + 0.35); // calm at the corners, tallest mid-screen
      const phase = p * Math.PI * 3;
      const edge = Array.from({ length: points + 1 }, (_, i) => {
        const s = from + ((to - from) * i) / points;
        const d = r + swell * (Math.sin(k * s + phase) + 0.35 * Math.sin(2.3 * k * s - 1.7 * phase));
        return [nx * d + tx * s, ny * d + ty * s];
      });
      const [first, last] = [edge[0], edge[points]];
      edge.push([last[0] - nx * behind, last[1] - ny * behind], [first[0] - nx * behind, first[1] - ny * behind]);
      return { clipPath: `polygon(${edge.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})` };
    });
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
    document.querySelector('.theme-toggle')?.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      popIcon(next === 'dark');
      if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTheme(next);
      root.classList.add('theme-wave');
      const transition = document.startViewTransition(() => setTheme(next));
      transition.ready.then(() => root.animate(waveFrames(), {
        duration: 900, easing: 'cubic-bezier(.45, 0, .2, 1)', pseudoElement: '::view-transition-new(root)',
      })).catch(() => {});
      transition.finished.finally(() => root.classList.remove('theme-wave'));
    });
    sync();
  });
  systemDark.addEventListener('change', sync);
})();
