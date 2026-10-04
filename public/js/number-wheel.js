import { h } from './dom.js';

/**
 * A horizontal picker wheel: numbers scroll sideways and the one snapped to the centre is chosen.
 * Swipe on touch, mouse wheel or click on desktop, arrow keys anywhere. `onChange` fires only for
 * the user's own choices, never for `setValue`, so the view can tell "untouched" from "chosen".
 * Items are spans, not buttons: inside a <label> (see `field`), a click on the label text would
 * otherwise be forwarded to the first button and pick the minimum.
 */
export function createNumberWheel({ min, max, value, label, onChange }) {
  let current = value, settle, layoutFrame, wheelDelta = 0;
  const items = Array.from({ length: max - min + 1 }, (_, i) => h('span', { class: 'wheel-item', 'aria-hidden': 'true', onclick: () => choose(min + i) }, String(min + i)));
  const track = h('div', { class: 'wheel-track', onscroll: () => { clearTimeout(settle); settle = setTimeout(fromScroll, 90); } }, ...items);
  const element = h('div', { class: 'number-wheel', role: 'spinbutton', tabindex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max, onkeydown: keydown }, track);
  element.addEventListener('wheel', wheel, { passive: false });
  // Hidden views have no width to scroll in, so re-centre whenever the wheel gets laid out again.
  if (typeof ResizeObserver === 'function') new ResizeObserver(centreAfterLayout).observe(track);
  paint();

  function paint() {
    element.setAttribute('aria-valuenow', current);
    items.forEach((item, i) => item.classList.toggle('selected', min + i === current));
  }
  function centre(behavior) {
    if (!track.clientWidth) return;
    const item = items[current - min];
    track.scrollTo?.({ left: item.offsetLeft - (track.clientWidth - item.offsetWidth) / 2, behavior });
  }
  function centreAfterLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => centre('instant'));
  }
  function choose(next) {
    next = Math.min(max, Math.max(min, next));
    if (next !== current) { current = next; paint(); onChange(current); }
    centre('smooth');
  }
  function fromScroll() {
    const middle = track.scrollLeft + track.clientWidth / 2;
    const nearest = items.reduce((best, item, i) => Math.abs(item.offsetLeft + item.offsetWidth / 2 - middle) < Math.abs(items[best].offsetLeft + items[best].offsetWidth / 2 - middle) ? i : best, 0);
    if (track.clientWidth && min + nearest !== current) { current = min + nearest; paint(); onChange(current); }
  }
  function keydown(event) {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    const jump = { Home: min, End: max }[event.key];
    if (step === undefined && jump === undefined) return;
    event.preventDefault();
    choose(jump ?? current + step);
  }
  function wheel(event) {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return; // sideways trackpad swipes scroll natively
    event.preventDefault();
    wheelDelta += event.deltaY;
    if (Math.abs(wheelDelta) < 40) return;
    choose(current + Math.sign(wheelDelta)); wheelDelta = 0;
  }
  return {
    element,
    setValue(next) { current = Math.min(max, Math.max(min, next)); paint(); centreAfterLayout(); },
  };
}
