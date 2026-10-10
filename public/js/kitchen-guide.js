import { api } from './api.js';
import { calmMotion, h, withBusy } from './dom.js';
import { emoji, field, icon } from './ui.js';
import { createNumberWheel } from './number-wheel.js';
import { createUnitPriorityPicker } from './unit-priority-picker.js';
import { englishOf, recipeLanguage, t, tn } from './i18n.js';
import { languageSelect } from './language-picker.js';

const TOOLS = [
  [t('Oven'), '♨️'], [t('Microwave'), '📻'], [t('Fridge'), '🧊'], [t('Air fryer'), '🍟'], [t('Hob'), '🍳'], [t('Freezer'), '❄️'],
  [t('Blender'), '🥤'], [t('Toaster'), '🍞'], [t('Kettle'), '🫖'],
];
const key = name => name.trim().toLocaleLowerCase();
/** Appliances saved before a language change, such as Oven after switching to French, take the suggestion's name. */
function inCurrentLanguage(appliances) {
  return appliances.map((item) => {
    const tool = TOOLS.find(([name]) => key(name) !== key(item.name) && key(englishOf(name)) === key(englishOf(item.name)));
    return tool && !appliances.some((other) => key(other.name) === key(tool[0])) ? { ...item, name: tool[0] } : item;
  });
}

/** Pantry basics first, then kitchen choices, with a little chef to guide the review. */
export function createKitchenGuide({ onSaved, onComplete, onAppliancesSaved, addAppliance, sections }) {
  let profile, step = 0, selected = [], servings = 2, saves = Promise.resolve(), saveError;
  let basics = [], pantrySelected = new Set();
  const sectionHome = sections[0].parentElement;
  const heading = h('h1', { tabindex: -1 });
  const tip = h('p', { class: 'guide-subtitle' });
  const progress = h('ol', { class: 'guide-progress', 'aria-label': t('Kitchen setup progress') });
  const choices = h('div', { class: 'guide-choices' });
  const welcome = h('div', { class: 'pantry-welcome' });
  const pantryGrid = h('div', { class: 'guide-tool-grid guide-pantry-grid', 'aria-label': t('Everyday pantry basics') });
  const pantryCount = h('p', { class: 'guide-selection-count', 'aria-live': 'polite' });
  const count = h('p', { class: 'guide-selection-count', 'aria-live': 'polite' });
  const tools = h('div', { class: 'guide-tool-grid', 'aria-label': t('Common appliances') });
  const extras = h('div', { class: 'guide-tool-grid' });
  const more = h('details', { class: 'guide-more' }, h('summary', {}, t('More appliances'), icon('chevron')), extras,
    h('button', { type: 'button', class: 'guide-custom', onclick: async () => { await saves; if (!saveError) addAppliance(); } }, icon('plus'), t('Add something else')));
  const limits = h('details', { class: 'guide-more guide-limits' }, h('summary', {}, t('Sizes & limits'), h('small', {}, t('optional')), icon('chevron')), sections[0]);
  const units = createUnitPriorityPicker('Metric (g, ml, °C)');
  // Picking a language reloads the page in it, so the other choices on this step are saved first.
  const language = languageSelect({ signedIn: true, 'aria-label': t('Recipe language'), onbeforechange: () => saves.then(() => api.updateProfile({ servings, units: units.value(), preferences: preferences.value.trim() })).catch(() => {}) });
  const wheel = createNumberWheel({ min: 1, max: 20, value: 2, label: t('Setup servings'), onChange: value => { servings = value; } });
  const diet = h('details', { class: 'guide-more guide-diet' }, h('summary', {}, t('Dietary preferences'), h('small', {}, t('optional')), icon('chevron')), sections[2]);
  const preferences = sections[2].querySelector('textarea');
  preferences.maxLength = 2000;
  const fields = h('div', { class: 'guide-fields' }, field(t('Usually cooking for'), wheel.element), field(t('Language'), language, t('Scoop writes recipes and talks to you in it.')),
    h('div', { class: 'guide-unit-field' }, h('span', { class: 'field-title' }, t('Unit priority')), units.element));
  const back = h('button', { type: 'button', onclick: () => move(step - 1) }, t('Back'));
  const next = h('button', { type: 'button', class: 'primary', onclick: () => move(step + 1) });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  const panel = h('section', { class: 'kitchen-guide', hidden: true, 'aria-label': t('Set up your kitchen with Scoop') },
    progress, heading, tip, choices, problem, h('div', { class: 'guide-actions' }, back, next));

  // The companion lives outside the sliding pages so it really floats in the viewport.
  let bubbleTimer, reactionTimer, tipIndex = 0, dragged = false, drag;
  const speech = h('p', { role: 'status', 'aria-live': 'polite' });
  const bubble = h('div', { class: 'scoop-bubble', hidden: true }, speech,
    h('button', { type: 'button', class: 'icon', 'aria-label': t('Close Scoop’s tip'), onclick: () => { bubble.hidden = true; clearTimeout(bubbleTimer); } }, icon('close')));
  const mascot = h('button', { type: 'button', class: 'scoop-pet', 'aria-label': t('Ask Scoop for a kitchen tip'), title: t('Tap for a tip · drag to move'), onclick: () => {
    if (dragged) { dragged = false; return; }
    const tips = step === 0
      ? [t('I picked a few everyday basics. Unselect anything you don’t have!'), t('No milk or eggs? Tap them off. Your pantry should feel like you.'), t('Keep as many or as few as you like. We can add more later.')]
      : step === 1
      ? [t('Keep only the tools you use. Tap a selected one to remove it.'), t('Something missing? Open More appliances to add it.'), t('Sizes and limits are optional. Add them later in My kitchen.')]
      : [t('These defaults are ready to go. Change anything, or tap Finish setup.'), t('Allergies or foods to avoid? Open Dietary preferences.'), t('Your kitchen can change! Edit it any time in My kitchen.')];
    speak(tips[tipIndex++ % tips.length], true); boop();
  } }, h('span', { class: 'scoop-float' }, h('img', { src: '/assets/scoop-guide.svg', alt: '', width: 96, height: 102 })), h('span', { class: 'scoop-name' }, 'Scoop', h('span', { 'aria-hidden': 'true' }, ' ✦')));
  const companion = h('aside', { class: 'scoop-companion', hidden: true, 'aria-label': t('Scoop, your floating kitchen helper') }, bubble, mascot);
  document.body.append(companion);
  function speak(message, sticky = false) {
    speech.textContent = message; bubble.hidden = false; clearTimeout(bubbleTimer);
    if (!sticky && step !== 0) bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 3500);
  }
  function boop() {
    companion.classList.add('delighted'); clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => companion.classList.remove('delighted'), 700);
    if (!calmMotion(mascot)) mascot.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14) rotate(-8deg)' }, { transform: 'scale(.97) rotate(5deg)' }, { transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
  }
  mascot.addEventListener('pointerdown', event => {
    if (event.button !== 0 || step === 0) return;
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

  function updateCount() { count.textContent = selected.length ? t('{count} selected · tap to change', { count: selected.length }) : t('No appliances selected — that’s fine, too.'); }
  function updatePantryCount() {
    pantryCount.textContent = pantrySelected.size ? tn(pantrySelected.size, '{count} basic ready for your pantry · tap to unselect', '{count} basics ready for your pantry · tap to unselect') : t('No basics selected — we’ll start with an empty basket.');
    if (step === 0) next.textContent = pantrySelected.size ? t('Keep these & continue') : t('Continue with none');
  }
  function bounce(button, chosen) {
    if (calmMotion(button)) return;
    button.animate([{ transform: 'scale(1)' }, { transform: chosen ? 'scale(.94) rotate(-2deg)' : 'scale(1.07) rotate(2deg)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  function pantryButton(item, index) {
    // `id` is the basic's stable English name; `name` is in the interface language.
    const id = item.id ?? item.name;
    const chosen = pantrySelected.has(id);
    const button = h('button', { type: 'button', class: `guide-tool guide-basic${chosen ? ' selected' : ''}`, style: `--i:${index}`, 'aria-pressed': String(chosen), onclick: () => {
      const wasSelected = pantrySelected.has(id);
      if (wasSelected) pantrySelected.delete(id); else pantrySelected.add(id);
      button.classList.toggle('selected', !wasSelected); button.setAttribute('aria-pressed', String(!wasSelected));
      updatePantryCount(); bounce(button, wasSelected); boop();
      speak(wasSelected ? t('{name} is out. Only what you have goes in the basket!', { name: item.name }) : t('{name} is back in the basket. Lovely!', { name: item.name }));
    } }, emoji(item.emoji, 'guide-tool-emoji'), h('span', {}, item.name), h('span', { class: 'guide-tool-check', 'aria-hidden': 'true' }, '✓'));
    return button;
  }
  function toolButton(name, symbol) {
    const isSelected = selected.some(item => key(item.name) === key(name));
    const button = h('button', { type: 'button', class: `guide-tool${isSelected ? ' selected' : ''}`, 'aria-pressed': String(isSelected), onclick: () => {
      const chosen = selected.some(item => key(item.name) === key(name));
      selected = chosen ? selected.filter(item => key(item.name) !== key(name)) : [...selected, { name, details: '', emoji: symbol }];
      button.classList.toggle('selected', !chosen); button.setAttribute('aria-pressed', String(!chosen)); updateCount();
      bounce(button, chosen);
      speak(chosen ? t('{name} is off the list. Your kitchen, your rules!', { name }) : t('{name} is in! A little more cooking magic.', { name }), false); boop();
      const snapshot = [...selected];
      saves = saves.then(async () => {
        try {
          const result = await api.updateProfile({ appliances: snapshot });
          profile = { ...profile, appliances: result.profile.appliances }; saveError = undefined;
          problem.hidden = true; onAppliancesSaved(result.profile);
        } catch (error) { saveError = error; problem.textContent = t('Could not save your appliances. {error} Tap Next to try again.', { error: error.message }); problem.hidden = false; }
      });
    } }, emoji(symbol, 'guide-tool-emoji'), h('span', {}, name), h('span', { class: 'guide-tool-check', 'aria-hidden': 'true' }, '✓'));
    return button;
  }
  function render(focus = false) {
    panel.hidden = !!profile.setupComplete; companion.hidden = !!profile.setupComplete;
    sections.forEach(section => { section.hidden = !!profile.setupComplete ? false : section === sections[1]; });
    if (profile.setupComplete) { sections.forEach(section => sectionHome.insertBefore(section, sectionHome.lastElementChild)); return; }
    companion.classList.toggle('packing', step === 0);
    mascot.title = step === 0 ? t('Tap Scoop for a pantry tip') : t('Tap for a tip · drag to move');
    if (step === 0) welcome.append(companion); else document.body.append(companion);
    heading.textContent = [t('A little pantry head start'), t('Your kitchen, your way'), t('A few finishing touches')][step];
    tip.textContent = [t('The basics are preselected. Unselect anything you don’t have.'), t('The usual tools are selected. Keep what you have.'), t('Ready-to-go defaults. Adjust them if you like.')][step];
    progress.replaceChildren(...[t('Your pantry'), t('Your appliances'), t('Your cooking')].map((label, index) => h('li', { class: index === step ? 'current' : index < step ? 'done' : '', 'aria-current': index === step ? 'step' : undefined }, h('span', {}, index < step ? '✓' : String(index + 1)), label)));
    if (step === 0) {
      pantryGrid.replaceChildren(...basics.map(pantryButton));
      choices.replaceChildren(welcome, pantryGrid, pantryCount);
      speak(t('Hi, I’m Scoop! I’ve packed a few everyday basics for you. Keep only what you have.'), true);
    } else if (step === 1) {
      const custom = selected.filter(item => !TOOLS.some(([name]) => key(name) === key(item.name)));
      tools.replaceChildren(...TOOLS.slice(0, 6).map(([name, symbol]) => toolButton(name, symbol)), ...custom.map(item => toolButton(item.name, item.emoji || '🍴')));
      extras.replaceChildren(...TOOLS.slice(6).map(([name, symbol]) => toolButton(name, symbol)));
      limits.append(sections[0]); choices.replaceChildren(tools, count, more, limits); updateCount();
    } else {
      diet.append(sections[2]); diet.open = !!preferences.value.trim(); choices.replaceChildren(fields, diet);
    }
    back.hidden = step === 0; next.textContent = step === 2 ? t('Finish setup') : t('Next');
    if (step === 0) updatePantryCount();
    if (focus && !calmMotion(choices)) choices.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 350, easing: 'ease-out' });
    if (focus) { heading.focus({ preventScroll: true }); panel.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  }
  async function move(target) {
    if (next.disabled || back.disabled) return;
    problem.hidden = true; back.disabled = true;
    const patch = { setupStep: Math.min(2, target), appliances: [...selected] };
    if (step === 2) {
      if (target > 2 && !units.reportValidity()) { back.disabled = false; return; }
      Object.assign(patch, { servings, units: units.value(), language: recipeLanguage(), preferences: preferences.value.trim() });
    }
    if (target > 2) patch.setupComplete = true;
    choices.inert = true;
    const result = await withBusy(next, step === 0 ? t('Packing your pantry…') : t('Saving…'), async () => {
      await saves;
      return step === 0 ? api.savePantryBasics([...pantrySelected]) : api.updateProfile(patch);
    });
    choices.inert = false;
    back.disabled = false;
    if (!result) { problem.textContent = t('Could not save your choices. They’re still here — tap Continue or Next to try again.'); problem.hidden = false; return; }
    saveError = undefined; onSaved(result.profile); render(true);
    if (result.profile.setupComplete) {
      companion.hidden = false; companion.classList.add('celebrating'); speak(t('All set! Let’s make something lovely.')); boop();
      setTimeout(() => { companion.hidden = true; companion.classList.remove('celebrating'); }, 3500);
      onComplete();
    } else { boop(); speak(step === 2 ? t('Almost there! These defaults are ready when you are.') : step === 1 ? t('Your basics are tucked away! Now, which tools do you have?') : t('Keep only what you have. Your basket, your rules!'), step === 0); }
  }
  function fill(nextProfile, nextBasics) {
    const firstVisit = !profile;
    profile = nextProfile; step = Math.min(2, profile.setupStep ?? 0); selected = inCurrentLanguage(profile.appliances);
    if (nextBasics) { basics = nextBasics; pantrySelected = new Set(basics.filter(item => item.selected).map(item => item.id ?? item.name)); }
    servings = profile.servings; wheel.setValue(servings);
    units.setValue(profile.units || 'Metric (g, ml, °C)'); render();
    if (firstVisit && !profile.setupComplete && step !== 0) speak(t('Hi, I’m Scoop! Your tiny chef. Tap me for a tip, or drag me out of the way.'));
  }
  return { element: panel, fill, active: () => profile?.setupComplete === false };
}
