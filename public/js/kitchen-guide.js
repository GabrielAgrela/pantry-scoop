import { api } from './api.js';
import { calmMotion, h, withBusy } from './dom.js';
import { emoji, field, icon } from './ui.js';
import { createNumberWheel } from './number-wheel.js';
import { createUnitPriorityPicker } from './unit-priority-picker.js';

const TOOLS = [
  ['Oven', '♨️'], ['Microwave', '📻'], ['Fridge', '🧊'], ['Air fryer', '🍟'], ['Hob', '🍳'], ['Freezer', '❄️'],
  ['Blender', '🥤'], ['Toaster', '🍞'], ['Kettle', '🫖'],
];
const key = name => name.trim().toLocaleLowerCase();

/** Two quick decisions, with a movable little chef offering help outside the form. */
export function createKitchenGuide({ onSaved, onComplete, onAppliancesSaved, addAppliance, sections }) {
  let profile, step = 0, selected = [], servings = 2, saves = Promise.resolve(), saveError;
  const sectionHome = sections[0].parentElement;
  const heading = h('h1', { tabindex: -1 });
  const tip = h('p', { class: 'guide-subtitle' });
  const progress = h('ol', { class: 'guide-progress', 'aria-label': 'Kitchen setup progress' });
  const choices = h('div', { class: 'guide-choices' });
  const count = h('p', { class: 'guide-selection-count', 'aria-live': 'polite' });
  const tools = h('div', { class: 'guide-tool-grid', 'aria-label': 'Common appliances' });
  const extras = h('div', { class: 'guide-tool-grid' });
  const more = h('details', { class: 'guide-more' }, h('summary', {}, 'More appliances', icon('chevron')), extras,
    h('button', { type: 'button', class: 'guide-custom', onclick: async () => { await saves; if (!saveError) addAppliance(); } }, icon('plus'), 'Add something else'));
  const limits = h('details', { class: 'guide-more guide-limits' }, h('summary', {}, 'Sizes & limits', h('small', {}, 'optional'), icon('chevron')), sections[0]);
  const units = createUnitPriorityPicker('Metric (g, ml, °C)');
  const language = h('input', { required: true, maxlength: 2000, 'aria-label': 'Recipe language', placeholder: 'e.g. English or Português' });
  const wheel = createNumberWheel({ min: 1, max: 20, value: 2, label: 'Setup servings', onChange: value => { servings = value; } });
  const diet = h('details', { class: 'guide-more guide-diet' }, h('summary', {}, 'Dietary preferences', h('small', {}, 'optional'), icon('chevron')), sections[2]);
  const preferences = sections[2].querySelector('textarea');
  preferences.maxLength = 2000;
  const fields = h('div', { class: 'guide-fields' }, field('Usually cooking for', wheel.element), field('Recipe language', language),
    h('div', { class: 'guide-unit-field' }, h('span', { class: 'field-title' }, 'Unit priority'), units.element));
  const back = h('button', { type: 'button', onclick: () => move(0) }, 'Back');
  const next = h('button', { type: 'button', class: 'primary', onclick: () => move(step + 1) });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  const panel = h('section', { class: 'kitchen-guide', hidden: true, 'aria-label': 'Set up your kitchen with Scoop' },
    progress, heading, tip, choices, problem, h('div', { class: 'guide-actions' }, back, next));

  // The companion lives outside the sliding pages so it really floats in the viewport.
  let bubbleTimer, reactionTimer, tipIndex = 0, dragged = false, drag;
  const speech = h('p', { role: 'status', 'aria-live': 'polite' });
  const bubble = h('div', { class: 'scoop-bubble', hidden: true }, speech,
    h('button', { type: 'button', class: 'icon', 'aria-label': 'Close Scoop’s tip', onclick: () => { bubble.hidden = true; clearTimeout(bubbleTimer); } }, icon('close')));
  const mascot = h('button', { type: 'button', class: 'scoop-pet', 'aria-label': 'Ask Scoop for a kitchen tip', title: 'Tap for a tip · drag to move', onclick: () => {
    if (dragged) { dragged = false; return; }
    const tips = step === 0
      ? ['Keep only the tools you use. Tap a selected one to remove it.', 'Something missing? Open More appliances to add it.', 'Sizes and limits are optional. Add them later in My kitchen.']
      : ['These defaults are ready to go. Change anything, or tap Finish setup.', 'Allergies or foods to avoid? Open Dietary preferences.', 'Your kitchen can change! Edit it any time in My kitchen.'];
    speak(tips[tipIndex++ % tips.length], true); boop();
  } }, h('span', { class: 'scoop-float' }, h('img', { src: '/assets/scoop-guide.svg', alt: '', width: 96, height: 102 })), h('span', { class: 'scoop-name' }, 'Scoop', h('span', { 'aria-hidden': 'true' }, ' ✦')));
  const companion = h('aside', { class: 'scoop-companion', hidden: true, 'aria-label': 'Scoop, your floating kitchen helper' }, bubble, mascot);
  document.body.append(companion);
  function speak(message, sticky = false) {
    speech.textContent = message; bubble.hidden = false; clearTimeout(bubbleTimer);
    if (!sticky) bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 3500);
  }
  function boop() {
    companion.classList.add('delighted'); clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => companion.classList.remove('delighted'), 700);
    if (!calmMotion(mascot)) mascot.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14) rotate(-8deg)' }, { transform: 'scale(.97) rotate(5deg)' }, { transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
  }
  mascot.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const box = companion.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: box.left, top: box.top, id: event.pointerId };
    mascot.setPointerCapture(event.pointerId);
  });
  mascot.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 6) return;
    dragged = true; bubble.hidden = true;
    const left = Math.max(8, Math.min(innerWidth - companion.offsetWidth - 8, drag.left + dx));
    const top = Math.max(64, Math.min(innerHeight - companion.offsetHeight - 90, drag.top + dy));
    companion.style.left = `${left}px`; companion.style.top = `${top}px`;
    companion.classList.toggle('at-left', left < 200); companion.classList.toggle('tip-below', top < 200);
    companion.style.right = 'auto'; companion.style.bottom = 'auto';
  });
  const endDrag = () => { drag = undefined; setTimeout(() => { dragged = false; }, 0); };
  mascot.addEventListener('pointerup', endDrag); mascot.addEventListener('pointercancel', () => { drag = undefined; dragged = false; });
  window.addEventListener('resize', () => { companion.style.left = ''; companion.style.top = ''; companion.style.right = ''; companion.style.bottom = ''; companion.classList.remove('at-left', 'tip-below'); });

  function updateCount() { count.textContent = selected.length ? `${selected.length} selected · tap to change` : 'No appliances selected — that’s fine, too.'; }
  function toolButton(name, symbol) {
    const isSelected = selected.some(item => key(item.name) === key(name));
    const button = h('button', { type: 'button', class: `guide-tool${isSelected ? ' selected' : ''}`, 'aria-pressed': String(isSelected), onclick: () => {
      const chosen = selected.some(item => key(item.name) === key(name));
      selected = chosen ? selected.filter(item => key(item.name) !== key(name)) : [...selected, { name, details: '', emoji: symbol }];
      button.classList.toggle('selected', !chosen); button.setAttribute('aria-pressed', String(!chosen)); updateCount();
      speak(chosen ? `${name} is off the list. Your kitchen, your rules!` : `${name} is in! A little more cooking magic.`, false); boop();
      const snapshot = [...selected];
      saves = saves.then(async () => {
        try {
          const result = await api.updateProfile({ appliances: snapshot });
          profile = { ...profile, appliances: result.profile.appliances }; saveError = undefined;
          problem.hidden = true; onAppliancesSaved(result.profile);
        } catch (error) { saveError = error; problem.textContent = `Could not save your appliances. ${error.message} Tap Next to try again.`; problem.hidden = false; }
      });
    } }, emoji(symbol, 'guide-tool-emoji'), h('span', {}, name), h('span', { class: 'guide-tool-check', 'aria-hidden': 'true' }, '✓'));
    return button;
  }
  function render(focus = false) {
    panel.hidden = !!profile.setupComplete; companion.hidden = !!profile.setupComplete;
    sections.forEach(section => { section.hidden = !!profile.setupComplete ? false : section === sections[1]; });
    if (profile.setupComplete) { sections.forEach(section => sectionHome.insertBefore(section, sectionHome.lastElementChild)); return; }
    heading.textContent = step === 0 ? 'Your kitchen, your way' : 'A few finishing touches';
    tip.textContent = step === 0 ? 'The usual tools are selected. Keep what you have.' : 'Ready-to-go defaults. Adjust them if you like.';
    progress.replaceChildren(...['Your appliances', 'Your cooking'].map((label, index) => h('li', { class: index === step ? 'current' : index < step ? 'done' : '', 'aria-current': index === step ? 'step' : undefined }, h('span', {}, index < step ? '✓' : String(index + 1)), label)));
    if (step === 0) {
      const custom = selected.filter(item => !TOOLS.some(([name]) => key(name) === key(item.name)));
      tools.replaceChildren(...TOOLS.slice(0, 6).map(([name, symbol]) => toolButton(name, symbol)), ...custom.map(item => toolButton(item.name, item.emoji || '🍴')));
      extras.replaceChildren(...TOOLS.slice(6).map(([name, symbol]) => toolButton(name, symbol)));
      limits.append(sections[0]); choices.replaceChildren(tools, count, more, limits); updateCount();
    } else {
      diet.append(sections[2]); diet.open = !!preferences.value.trim(); choices.replaceChildren(fields, diet);
    }
    back.hidden = step === 0; next.textContent = step === 0 ? 'Next' : 'Finish setup';
    if (focus) { heading.focus({ preventScroll: true }); panel.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  }
  async function move(target) {
    if (next.disabled || back.disabled) return;
    problem.hidden = true; back.disabled = true;
    const patch = { setupStep: target > 0 ? 1 : 0, appliances: [...selected] };
    if (step === 1) {
      language.setCustomValidity(language.value.trim() ? '' : 'Enter your recipe language.');
      if (target > 1 && (!units.reportValidity() || !language.reportValidity())) { back.disabled = false; return; }
      Object.assign(patch, { servings, units: units.value(), language: language.value.trim(), preferences: preferences.value.trim() });
    }
    if (target > 1) patch.setupComplete = true;
    choices.inert = true;
    const result = await withBusy(next, 'Saving…', async () => { await saves; return api.updateProfile(patch); });
    choices.inert = false;
    back.disabled = false;
    if (!result) return;
    saveError = undefined; onSaved(result.profile); render(true);
    if (result.profile.setupComplete) {
      companion.hidden = false; companion.classList.add('celebrating'); speak('All set! Let’s make something lovely.'); boop();
      setTimeout(() => { companion.hidden = true; companion.classList.remove('celebrating'); }, 3500);
      onComplete();
    } else speak(step === 1 ? 'Almost there! These defaults are ready when you are.' : 'Keep what you use. I’ll take care of the recipe ideas.');
  }
  function fill(nextProfile) {
    const firstVisit = !profile;
    profile = nextProfile; step = Math.min(1, profile.setupStep ?? 0); selected = [...profile.appliances];
    servings = profile.servings; wheel.setValue(servings);
    units.setValue(profile.units || 'Metric (g, ml, °C)'); language.value = profile.language || 'English'; render();
    if (firstVisit && !profile.setupComplete) speak('Hi, I’m Scoop! Your tiny chef. Tap me for a tip, or drag me out of the way.');
  }
  return { element: panel, fill, active: () => profile?.setupComplete === false };
}
