/**
 * Tiny element builder. Text is always inserted as text nodes, never parsed as HTML,
 * so ingredient names coming from photos or the AI cannot inject markup.
 *
 *   h('button', { class: 'primary', onclick: save }, 'Save')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    // `value` must be a property: <textarea> ignores the attribute.
    else if (key === 'value' || (key in el && typeof value !== 'string')) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

let toastTimer;

export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

export function toast(message, { error = false, action } = {}) {
  const el = document.getElementById('toast');
  el.replaceChildren(message, action ? h('a', { class: 'toast-action', href: action.href, target: '_blank', rel: 'noopener' }, action.label) : '');
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 12000 : error ? 6000 : 3500);
}

/** Shows an API error; a usage limit gets "Manage usage" as its primary action. */
export function showError(error) {
  if (error.code === 'auth-required') return; // the sign-in screen takes over
  const action = error.code === 'usage-limit' ? { label: 'Manage usage', href: error.manageUsageUrl ?? MANAGE_USAGE_URL } : undefined;
  toast(error.message, { error: true, action });
}

/** Runs an async action while a button shows a busy label; reports failures as a toast. */
export async function withBusy(button, busyLabel, action) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await action();
  } catch (error) {
    showError(error);
    return undefined;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/** Modal dialog that removes itself when closed. Returns { dialog, close }. */
export function openDialog(className, ...content) {
  const dialog = h('dialog', { class: `card stack ${className}` }, ...content);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close(); // tap outside
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}
