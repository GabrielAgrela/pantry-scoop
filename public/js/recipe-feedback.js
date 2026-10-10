import { api } from './api.js';
import { h, MANAGE_USAGE_URL, openDialog } from './dom.js';
import { emoji, icon } from './ui.js';
import { readable, t, tn } from './i18n.js';

/** How many times the cook may answer Scoop's proposed notes before keeping them (the server allows the same). */
const STEERING_ROUNDS = 3;

/**
 * Closes the method page. "I cooked this" asks what ran out, logs the meal, then offers the
 * feedback chat: the cook tells Scoop how it went, Scoop replies and proposes notes for its
 * memory; only the ones the cook keeps ticked are remembered, and they steer later recipe ideas.
 * `pantry` is the recipe sheet's view of the pantry items behind the recipe (see recipePages);
 * `onShowMemory` closes the recipe and opens the memory in My kitchen.
 */
export function recipeFeedbackCard(recipe, { pantry, onShowMemory }) {
  let logged = false;
  const heading = h('strong', {}, t('Cooked it?'));
  const text = h('p', {}, t('Tick off anything that ran out, then tell Scoop how it went.'));
  const feedback = () => openFeedback(recipe, onShowMemory);
  const button = h('button', { type: 'button', class: 'primary', onclick: () => (logged ? feedback() : openCooked(recipe, pantry, { onLogged, onFeedback: feedback })) },
    emoji('🍳'), t('I cooked this'));
  // Once logged, the card keeps the way into the chat for later.
  function onLogged() {
    logged = true;
    heading.textContent = t('Cooked today!');
    text.textContent = t('It’s in your cooking log. Tell Scoop how it went whenever you like.');
    button.replaceChildren(emoji('💬'), t('Feedback'));
  }
  return h('aside', { class: 'recipe-feedback-card' },
    h('img', { src: '/assets/scoop-guide.svg', alt: '', width: 48, height: 51 }),
    h('div', {}, heading, text), button);
}

/**
 * "Anything run out?": the recipe's pantry items still in stock, all unticked since most meals
 * finish nothing. Done logs the meal and marks the ticked ones as run out in one go, then offers
 * the feedback chat.
 */
function openCooked(recipe, pantry, { onLogged, onFeedback }) {
  const checks = pantry.inStock().map((item) => {
    const check = h('input', { type: 'checkbox', onchange: count });
    return { item, check, row: h('li', {}, h('label', { class: 'cooked-item' },
      h('span', { class: 'review-checkbox' }, check, h('span', {}, icon('check'))),
      emoji(item.emoji || '🫙'), h('span', {}, item.name))) };
  });
  const body = h('div', { class: 'cooked-body' }, checks.length
    ? [h('p', { class: 'cooked-hint' }, t('Tick only what you finished. Everything else stays in your pantry.')), h('ul', { class: 'cooked-list' }, ...checks.map(({ row }) => row))]
    : h('p', { class: 'cooked-hint' }, t('Nothing from your pantry to tick off this time.')));
  const error = h('p', { class: 'recipe-chat-error', role: 'alert', hidden: true });
  const back = h('button', { type: 'button', onclick: () => sheet.close() }, t('Back to recipe'));
  const done = h('button', { type: 'button', class: 'primary', onclick: log });
  const heading = h('h4', {}, t('Anything run out?'));
  const footer = h('div', { class: 'recipe-chat-form' }, error, h('div', { class: 'memory-actions' }, back, done));
  const sheet = openDialog('recipe-chat cooked-sheet',
    h('header', { class: 'recipe-chat-header' },
      h('img', { class: 'recipe-chat-face', src: '/assets/scoop-guide.svg', alt: '', width: 64, height: 68 }),
      h('div', {}, heading, h('p', {}, readable(recipe).title)),
      h('button', { type: 'button', class: 'icon', 'aria-label': t('Back to recipe'), onclick: () => sheet.close() }, icon('close'))),
    body, footer);
  sheet.dialog.setAttribute('aria-label', t('I cooked {title}', { title: readable(recipe).title }));
  count();
  done.focus({ preventScroll: true });

  function count() {
    const chosen = checks.filter(({ check }) => check.checked).length;
    done.replaceChildren(icon('check'), !checks.length ? t('Log it') : chosen ? tn(chosen, '{count} item ran out', '{count} items ran out') : t('Nothing ran out'));
  }
  async function log() {
    const finished = checks.filter(({ check }) => check.checked).map(({ item }) => item);
    const ids = finished.map((item) => item.pantryId);
    done.disabled = back.disabled = true; error.hidden = true;
    checks.forEach(({ check }) => { check.disabled = true; });
    try {
      await api.cookedRecipe(recipe, ids);
    } catch (failure) {
      error.textContent = failure.message; error.hidden = false;
      done.disabled = back.disabled = false;
      checks.forEach(({ check }) => { check.disabled = false; });
      return;
    }
    pantry.ranOut(ids);
    onLogged();
    heading.textContent = t('Cooked today!');
    body.replaceChildren(h('div', { class: 'recipe-chat-message' }, h('strong', {}, 'Scoop'),
      h('p', {}, finished.length
        ? tn(finished.length, 'Logged for today! {names} is now marked as run out.', 'Logged for today! {names} are now marked as run out.', { names: finished.map((item) => item.name).join(', ') })
        : t('Logged for today! Enjoy your meal.'))));
    const later = h('button', { type: 'button', onclick: () => sheet.close() }, t('Not now'));
    const tell = h('button', { type: 'button', class: 'primary', onclick: () => { sheet.close(); onFeedback(); } }, emoji('💬'), t('Tell Scoop how it went'));
    footer.replaceChildren(h('div', { class: 'memory-actions' }, later, tell));
    tell.focus({ preventScroll: true });
  }
}

function openFeedback(recipe, onShowMemory) {
  let sending = false, proposal;
  /** Finished exchanges, and the notes currently offered, so a reply can steer them. */
  const history = [];
  let proposed = [];
  const log = h('div', { class: 'recipe-chat-log', role: 'log', 'aria-label': t('Feedback conversation'), 'aria-live': 'polite' });
  const say = (role, content) => {
    const entry = h('div', { class: `recipe-chat-message ${role}` }, h('strong', {}, role === 'user' ? t('You') : 'Scoop'), h('p', {}, content));
    log.append(entry); log.scrollTop = log.scrollHeight;
    return entry;
  };
  say('assistant', t('How did it turn out? Tell me what you loved, what you’d change, or anything about your kitchen I should know.'));
  const input = h('textarea', { rows: 3, maxLength: 2000, required: true, placeholder: t('A bit too sweet, and my oven browned it fast…'), 'aria-label': t('Your feedback on {title}', { title: readable(recipe).title }) });
  const send = h('button', { type: 'submit', class: 'primary', 'aria-label': t('Send feedback to Scoop') }, icon('arrow'));
  const error = h('p', { class: 'recipe-chat-error', role: 'alert', hidden: true });
  const report = (failure) => {
    error.replaceChildren(failure.message,
      failure.code === 'usage-limit' ? h('a', { href: failure.manageUsageUrl ?? MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, t('Manage usage')) : '');
    error.hidden = false;
  };
  const compose = h('div', { class: 'recipe-chat-compose' }, input, h('div', { class: 'recipe-chat-actions' }, send));
  const footer = h('form', { class: 'recipe-chat-form', onsubmit: submit }, error, compose);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); footer.requestSubmit(); }
  });
  const chat = openDialog('recipe-chat recipe-feedback',
    h('header', { class: 'recipe-chat-header' },
      h('img', { class: 'recipe-chat-face', src: '/assets/scoop-guide.svg', alt: '', width: 64, height: 68 }),
      h('div', {}, h('h4', {}, t('How did it go?')), h('p', {}, readable(recipe).title)),
      h('button', { type: 'button', class: 'icon', 'aria-label': t('Back to recipe'), onclick: () => chat.close() }, icon('close'))),
    log, footer);
  chat.dialog.setAttribute('aria-label', t('Feedback on {title}', { title: readable(recipe).title }));
  input.focus({ preventScroll: true });

  async function submit(event) {
    event.preventDefault();
    const feedback = input.value.trim();
    if (!feedback || sending) return;
    sending = true; send.disabled = input.disabled = true; error.hidden = true;
    const actions = [...footer.querySelectorAll('.memory-actions button'), ...(proposal?.querySelectorAll('input') ?? [])];
    actions.forEach((control) => { control.disabled = true; });
    const mine = say('user', feedback);
    const pending = h('div', { class: 'recipe-chat-thinking', role: 'status' },
      h('img', { src: '/assets/scoop-guide.svg', alt: '', width: 36, height: 38 }),
      h('span', {}, t('Scoop is thinking')), h('span', { class: 'loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    log.append(pending); log.scrollTop = log.scrollHeight;
    try {
      const { reply, notes } = await api.recipeFeedback(recipe, feedback, history, history.length ? proposed : []);
      pending.remove();
      say('assistant', reply);
      history.push({ role: 'user', content: feedback }, { role: 'assistant', content: reply });
      sending = false; send.disabled = input.disabled = false; input.value = '';
      notes.length ? propose(notes) : (proposal?.remove(), finish(t('Done')));
    } catch (failure) {
      pending.remove(); mine.remove(); report(failure);
      actions.forEach((control) => { control.disabled = false; });
      sending = false; send.disabled = input.disabled = false; input.focus({ preventScroll: true });
    }
  }

  /**
   * Every proposed note starts ticked; the cook unticks what Scoop should not keep, or answers to
   * change them ("30% is enough"), and the revised list replaces this one.
   */
  function propose(notes) {
    proposed = notes;
    proposal?.remove();
    const checks = notes.map((note) => {
      const check = h('input', { type: 'checkbox', checked: true, 'aria-label': note, onchange: count });
      return { note, check, row: h('li', {}, h('label', { class: 'review-checkbox' }, check, h('span', {}, icon('check'))), h('span', {}, note)) };
    });
    const canSteer = history.length / 2 <= STEERING_ROUNDS;
    proposal = h('section', { class: 'memory-proposal', 'aria-label': t('Notes Scoop wants to remember') },
      h('p', { class: 'memory-proposal-title' }, emoji('🧠'), t('I’ll remember')),
      h('ul', {}, ...checks.map(({ row }) => row)),
      h('p', { class: 'memory-proposal-hint' }, canSteer ? t('Untick anything I shouldn’t keep, or tell me what to change.') : t('Untick anything I shouldn’t keep.')));
    log.append(proposal);
    log.scrollTop = log.scrollHeight;
    const keep = h('button', { type: 'button', class: 'primary', onclick: confirm });
    const skip = h('button', { type: 'button', onclick: () => chat.close() }, t('Not now'));
    input.placeholder = t('Not quite? Tell Scoop what to change…');
    input.setAttribute('aria-label', t('Tell Scoop what to change in these notes'));
    send.setAttribute('aria-label', t('Send to Scoop'));
    compose.classList.add('is-steering');
    input.rows = 2;
    footer.replaceChildren(error, canSteer ? compose : '', h('div', { class: 'memory-actions' }, skip, keep));
    count();
    keep.focus({ preventScroll: true });

    function count() {
      const chosen = checks.filter(({ check }) => check.checked).length;
      keep.disabled = chosen === 0;
      keep.replaceChildren(icon('check'), chosen === notes.length ? t('Remember') : t('Remember {count}', { count: chosen }));
    }
    async function confirm() {
      const chosen = checks.filter(({ check }) => check.checked).map(({ note }) => note);
      if (!chosen.length) return;
      keep.disabled = skip.disabled = send.disabled = input.disabled = true; error.hidden = true;
      checks.forEach(({ check }) => { check.disabled = true; });
      try {
        await api.remember(chosen, recipe.title);
        say('assistant', chosen.length === 1 ? t('Got it! I’ll keep that in mind for your next ideas.') : t('Got it! I’ll keep those in mind for your next ideas.'));
        finish(t('Done'), true);
      } catch (failure) {
        report(failure);
        keep.disabled = skip.disabled = send.disabled = input.disabled = false;
        checks.forEach(({ check }) => { check.disabled = false; });
      }
    }
  }

  function finish(label, remembered = false) {
    const done = h('button', { type: 'button', class: 'primary', onclick: () => chat.close() }, label);
    const memory = remembered ? h('button', { type: 'button', onclick: () => { chat.close(); onShowMemory(); } }, emoji('🧠'), t('See Scoop’s memory')) : '';
    footer.replaceChildren(error, h('div', { class: 'memory-actions' }, memory, done));
    done.focus({ preventScroll: true });
  }
}
