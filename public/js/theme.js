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

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.theme-toggle')?.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch { /* still applies for this visit */ }
      sync();
    });
    sync();
  });
  systemDark.addEventListener('change', sync);
})();
