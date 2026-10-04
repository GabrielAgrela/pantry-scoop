/**
 * Animates a <details> open and closed instead of snapping. The element after <summary> grows to
 * its height while CSS plays `.is-opening` / `.is-closing` (e.g. staggering children in). `stagger`
 * picks the elements that get a `--i` index, counted when each animation starts so children added
 * later are included. A second click mid-animation reverses from wherever the panel is. Reduced
 * motion keeps the native toggle.
 */
export function smoothDetails(details, { stagger = (body) => [...body.children], maxStagger = 8, openMs = 380, closeMs = 260 } = {}) {
  const summary = details.querySelector(':scope > summary');
  const body = summary.nextElementSibling;
  let animation;
  summary.addEventListener('click', (event) => {
    if (!body.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    event.preventDefault();
    const closing = details.open && !details.classList.contains('is-closing');
    const start = details.open ? body.getBoundingClientRect().height : 0;
    animation?.cancel();
    stagger(body).forEach((child, i) => child.style.setProperty('--i', String(Math.min(i, maxStagger))));
    details.open = true;
    details.classList.toggle('is-closing', closing);
    details.classList.toggle('is-opening', !closing);
    const end = closing ? 0 : body.scrollHeight;
    body.style.overflow = 'hidden';
    animation = body.animate({ height: [`${start}px`, `${end}px`], opacity: closing ? [1, 0] : [start ? 1 : 0, 1] },
      { duration: closing ? closeMs : openMs, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    animation.onfinish = () => {
      if (closing) details.open = false;
      details.classList.remove('is-closing', 'is-opening');
      body.style.overflow = '';
      animation = undefined;
    };
  });
}
