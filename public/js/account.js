import { api } from './api.js';
import { signInWithGoogle } from './sign-in.js';
import { blobBuddy, feel } from './blob-buddy.js';
import { calmMotion, h, MANAGE_USAGE_URL, openDialog, showError, toast } from './dom.js';
import { icon, pantryFriend } from './ui.js';
import { localeTag, t, tn } from './i18n.js';
import { languageSelect } from './language-picker.js';

const manageUsageLink = (label = t('Manage usage')) =>
  h('a', { href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, label);

/** Header account menu: who is signed in, ChatGPT plan and model, then account actions. */
export function renderAccount(root, account, { mode, onSignedOut, onEnablePlan, onRestoreDefaults }) {
  const { user, planUsageEnabled } = account;
  const model = h('select', { 'aria-label': t('AI model'), onchange: async () => {
    try {
      await api.setModel(model.value);
    } catch (error) {
      showError(error);
    }
  } }, h('option', { value: '' }, t('Automatic')));
  if (planUsageEnabled) loadModels(model, user.model);

  const signOut = async () => {
    const result = await api.signOut().catch(() => ({ revoked: false }));
    if (!result.revoked) toast(t('Signed out. If you want to fully disconnect, remove Pantry Scoop in ChatGPT settings.'));
    onSignedOut();
  };
  const deleteAccount = async () => {
    if (!confirm(t('Delete your account and everything in it? This can’t be undone.'))) return;
    try {
      await api.deleteAccount();
      onSignedOut();
    } catch (error) {
      showError(error);
    }
  };
  const item = (symbol, label, onclick) => h('button', { class: 'menu-item', onclick }, icon(symbol), label);

  // Which intelligence runs scans and recipes, and which providers this account signs in with.
  const aiSection = h('div', { class: 'menu-section', 'aria-busy': 'true' });
  const linkSection = h('div', { class: 'menu-section linked-accounts', hidden: true });
  const planRows = () => [
    h('div', { class: 'plan' }, icon('check'), h('span', {}, t('Using your ChatGPT plan')),
      h('a', { href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener', 'aria-label': t('Manage usage in ChatGPT') }, t('Usage'), icon('external'))),
    h('label', { class: 'model-field' }, h('span', {}, t('AI model')), model),
  ];
  const disconnect = async (provider, name) => {
    if (!confirm(t('Disconnect {name} from this account? You can connect it again later.', { name }))) return;
    try {
      await api.disconnect(provider);
      location.reload();
    } catch (error) {
      showError(error);
    }
  };
  const providerRow = (name, connected, connect, provider) =>
    h('div', { class: 'provider-row' },
      h('span', { class: connected ? 'provider on' : 'provider' }, connected ? icon('check') : '', name),
      connected
        ? h('button', { class: 'link-button', onclick: () => disconnect(provider, name) }, t('Disconnect'))
        : h('button', { class: 'link-button', onclick: connect }, t('Connect')));
  const fillConnections = async () => {
    let view;
    try {
      view = await api.getConnections();
    } catch {
      aiSection.replaceChildren(...(planUsageEnabled ? planRows() : [enablePlanPrompt(onEnablePlan)]));
      return;
    }
    aiSection.removeAttribute('aria-busy');
    document.body.dataset.ai = view.aiProvider;
    window.dispatchEvent(new CustomEvent('pantry:ai-changed'));
    const usingPlan = view.aiProvider === 'chatgpt';
    const choice = h('select', { 'aria-label': t('Intelligence'), onchange: async () => {
      try {
        const next = await api.setAi(choice.value);
        toast(next.aiProvider === 'deepseek' ? t('Scans and recipes now use DeepSeek') : t('Scans and recipes now use ChatGPT'));
        fillConnections();
      } catch (error) {
        showError(error);
        choice.value = view.aiProvider;
      }
    } }, h('option', { value: 'chatgpt' }, t('ChatGPT plan')), h('option', { value: 'deepseek' }, 'DeepSeek'));
    choice.value = view.aiProvider;
    aiSection.replaceChildren(
      view.deepseekAvailable ? h('label', { class: 'model-field' }, h('span', {}, t('Intelligence')), choice) : '',
      ...(usingPlan
        ? view.chatgptPlan ? planRows() : [enablePlanPrompt(onEnablePlan)]
        : [h('div', { class: 'plan' }, icon('check'), h('span', {}, t('Using DeepSeek')))]),
    );
    linkSection.replaceChildren(
      h('span', { class: 'muted menu-label' }, t('Sign in with')),
      providerRow('ChatGPT', view.chatgpt, onEnablePlan, 'chatgpt'),
      view.googleAvailable || view.google ? providerRow('Google', view.google, signInWithGoogle, 'google') : '',
    );
    linkSection.hidden = false;
  };
  fillConnections();
  // Some sign-ins only carry an email, which then arrives as the name too.
  const name = user.name && user.name !== user.email ? user.name : '';
  // Today's AI requests left, refreshed each time the menu opens; a failed lookup hides it.
  const usageCount = h('span');
  const usage = h('span', { class: 'chip ai-usage', hidden: true }, icon('spark'), usageCount);
  const showUsage = async () => {
    try {
      const { used, limit, resetsAt } = await api.getAiUsage();
      const left = Math.max(0, limit - used);
      usage.hidden = limit === 0;
      usage.classList.toggle('warn', left === 0);
      usageCount.textContent = tn(limit, '{left}/{count} AI request left today', '{left}/{count} AI requests left today', { left });
      const resets = new Date(resetsAt).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' });
      usage.title = t('Scans, recipe ideas and sorting each use one. Resets at {time}.', { time: resets });
    } catch { usage.hidden = true; }
  };
  void showUsage();

  // The same blob twice: a small one in the header and a big one in the menu that watches the pointer.
  const seed = user.email || user.name || '?';
  const says = h('span', { class: 'blob-says', 'aria-hidden': 'true' });
  const buddy = blobBuddy(seed, { className: 'blob-big', speech: says, crop: 6 });

  const menu = h('details', { class: 'account-menu' },
      h('summary', { 'aria-label': t('Account') },
        blobBuddy(seed, { className: 'avatar', crop: 13 }).el,
      ),
      h('div', { class: 'card menu' },
        h('div', { class: 'menu-section account-who' },
          h('button', { type: 'button', class: 'blob-stage', 'aria-label': t('Poke your blob buddy'), onclick: () => buddy.poke() }, buddy.el, says),
          h('strong', {}, name || user.email),
          name ? h('span', { class: 'muted' }, user.email) : '',
          usage),
        h('div', { class: 'menu-section' }, h('label', { class: 'model-field' }, h('span', {}, t('Language')), languageSelect({ signedIn: true }))),
        aiSection,
        linkSection,
        h('div', { class: 'menu-section menu-items' },
          // Only needed when ChatGPT can't send phones back here (open-source loopback flow).
          mode === 'local' ? item('phone', t('Sign in on your phone'), showPhoneQr) : '',
          item('reset', t('Restart kitchen setup'), onRestoreDefaults),
          item('signout', t('Sign out'), signOut),
          h('button', { class: 'menu-item danger', onclick: deleteAccount }, icon('trash'), t('Delete account'))),
      ),
    );
  // Opening is the fold played backwards: the avatar nods and the card springs out of it.
  // Closing folds the card back up into the avatar, which gives a little nod as it lands.
  let folding;
  let unfolding;
  const openMenu = () => {
    menu.open = true;
    void showUsage();
    buddy.follow(true);
    feel('happy', 1200);
    const panel = menu.querySelector('.menu');
    if (calmMotion(panel)) return;
    menu.querySelector('.avatar')?.animate([{ transform: 'none' }, { transform: 'scale(.9) rotate(6deg)', offset: 0.4 }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    unfolding = panel.animate([
      { transform: 'translate(6px, -14px) scale(.35) rotate(6deg)', opacity: 0, easing: 'cubic-bezier(.2, .8, .3, 1)' },
      { transform: 'translateY(2px) scale(1.02, .98)', opacity: 1, offset: 0.7, easing: 'ease-out' },
      { transform: 'none', opacity: 1 },
    ], { duration: 300 });
    unfolding.onfinish = () => { unfolding = undefined; };
  };
  const closeMenu = () => {
    if (!menu.open || folding) return;
    buddy.follow(false);
    unfolding?.cancel();
    unfolding = undefined;
    const panel = menu.querySelector('.menu');
    if (calmMotion(panel)) { menu.open = false; return; }
    menu.classList.add('is-closing');
    folding = panel.animate([
      { transform: 'none', opacity: 1, easing: 'cubic-bezier(.3, 0, .5, 1)' },
      { transform: 'translateY(3px) scale(1.02, .97)', opacity: 1, offset: 0.2, easing: 'cubic-bezier(.55, 0, .85, .4)' },
      { transform: 'translate(6px, -14px) scale(.35) rotate(6deg)', opacity: 0 },
    ], { duration: 260, fill: 'forwards' });
    folding.onfinish = () => {
      menu.open = false;
      menu.classList.remove('is-closing');
      folding.cancel();
      folding = undefined;
      menu.querySelector('.avatar')?.animate([{ transform: 'none' }, { transform: 'scale(.88) rotate(-8deg)', offset: 0.35 }, { transform: 'scale(1.06) rotate(4deg)', offset: 0.7 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
    };
  };
  menu.querySelector(':scope > summary').addEventListener('click', (event) => {
    event.preventDefault();
    if (!menu.open) openMenu();
    else if (folding) { folding.onfinish = null; folding.cancel(); folding = undefined; menu.classList.remove('is-closing'); buddy.follow(true); } // tapped again: stay open
    else closeMenu();
  });
  // Close after choosing something, and when tapping anywhere else.
  menu.addEventListener('click', (event) => {
    if (event.target.closest('.menu button:not(.blob-stage)')) closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target)) closeMenu();
  });
  root.replaceChildren(menu);
}

/** Shown when the user signed in but didn't allow plan usage. */
function enablePlanPrompt(onEnable) {
  return h('div', { class: 'stack' },
    h('span', {}, t('Allow ChatGPT plan use to scan and get recipes.')),
    h('button', { class: 'primary chatgpt', onclick: onEnable }, t('Continue with ChatGPT')),
  );
}

/** One-time confirmation after the first sign-in with plan usage (per OpenAI's UX guidelines). */
export function showPlanWelcome() {
  const { close } = openDialog('welcome',
    pantryFriend('welcome-friend'),
    h('h3', {}, t('You’re using your ChatGPT plan')),
    h('p', {}, manageUsageLink(t('Manage usage')), t(' in ChatGPT settings.')),
    h('button', { class: 'primary', onclick: () => {
      close();
      api.dismissPlanWelcome().catch(() => {});
    } }, t('Got it')),
  );
}

/** QR code the phone scans with its camera to sign in as this account. */
async function showPhoneQr() {
  let link;
  try {
    link = await api.createDeviceLink();
  } catch (error) {
    showError(error);
    return;
  }
  const { close } = openDialog('qr',
    h('h3', {}, t('Scan with your phone')),
    h('img', { src: link.qrDataUrl, alt: t('Sign-in QR code'), width: 240, height: 240 }),
    h('p', { class: 'muted' }, t('Same Wi-Fi · works once · 10 min')),
    h('button', { class: 'primary', onclick: () => close() }, t('Done')),
  );
}

async function loadModels(select, current) {
  try {
    const { models } = await api.listModels();
    select.append(...models.map((m) => h('option', { value: m.slug, selected: m.slug === current }, m.displayName)));
  } catch {
    // The menu still works without the list; "Automatic" remains available.
  }
}
