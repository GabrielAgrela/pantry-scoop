/**
 * Keeps the recipe composer folded to its heading until it is tapped. While folded the whole card
 * acts as the toggle and its emoji jingles now and then (CSS, on `.is-collapsed`). Opening grows the
 * body from the hint to the full form while CSS pops the emoji and staggers the form rows in; tapping
 * the heading again folds it back. A second tap mid-animation reverses from wherever the body is.
 */
export function composeReveal(card, toggle) {
  const body = card.querySelector('.compose-body');
  const form = body.querySelector('form');
  [...form.children].forEach((child, i) => child.style.setProperty('--i', String(i)));
  let animation, foldedHeight = 0;
  toggle.addEventListener('click', () => setOpen(card.classList.contains('is-collapsed') || card.classList.contains('is-closing')));
  function setOpen(opening) {
    toggle.setAttribute('aria-expanded', String(opening));
    const animate = body.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = body.getBoundingClientRect().height;
    if (card.classList.contains('is-collapsed')) foldedHeight = start;
    animation?.cancel();
    card.classList.remove('is-opening');
    if (opening) {
      card.classList.remove('is-collapsed', 'is-closing');
      if (!animate) return;
      void card.offsetWidth; // restart the squish if a close was interrupted
      card.classList.add('is-opening');
    } else {
      card.classList.add('is-closing');
      if (!animate) return finish();
    }
    const end = opening ? body.scrollHeight : foldedHeight;
    body.style.overflow = 'hidden';
    animation = body.animate({ height: [`${start}px`, `${end}px`], ...(opening ? {} : { opacity: [1, 0.3] }) },
      { duration: opening ? 560 : 280, easing: opening ? 'cubic-bezier(.3, 1.25, .5, 1)' : 'cubic-bezier(.4, 0, .2, 1)' });
    animation.onfinish = finish;
  }
  function finish() {
    if (card.classList.contains('is-closing')) card.classList.replace('is-closing', 'is-collapsed');
    card.classList.remove('is-opening');
    body.style.overflow = '';
    animation = undefined;
  }
  return {
    close() {
      if (!card.classList.contains('is-collapsed') && !card.classList.contains('is-closing')) setOpen(false);
    },
  };
}
