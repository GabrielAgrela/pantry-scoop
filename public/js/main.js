import { renderAccount, showPlanWelcome } from './account.js';
import { api, SIGNED_OUT_EVENT } from './api.js';
import { createLoginView } from './views/login.js';
import { createProfileView } from './views/profile.js';
import { createRecipesView } from './views/recipes.js';
import { createShoppingView } from './views/shopping.js';
import { createStockView } from './views/stock.js';
import { h } from './dom.js';
import { platform } from './platform.js';
import { clearPendingLanguage, languageOfText, locale, pendingLanguage, recipeLanguage, setLanguage, t, translatePage } from './i18n.js';

translatePage();

const loginRoot = document.getElementById('view-login');
const accountRoot = document.getElementById('account');
const tabbar = document.querySelector('.tabbar');
const loading = document.getElementById('app-loading');
const pager = document.querySelector('.pages');
const PAGES = ['stock', 'recipes', 'shopping', 'profile'];
const TITLES = { stock: t('My pantry'), recipes: t('Recipes'), shopping: t('Shopping list'), profile: t('My kitchen') };
const pageOf = (name) => document.getElementById(`view-${name}`).parentElement;
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let views;
let mode = 'local';
let google = false;
let signedIn = false;
let current;
let heading; // the page a tab or link is scrolling to; the pages passed on the way are not visits
let settleTimer;
let frame;
const loaded = new Set();
const indicator = document.querySelector('.tab-indicator');
let slideLayout;

// Tab positions only change when the navigation resizes, not while a finger moves the pager.
function measureSlide() {
  return {
    width: pager.clientWidth || 1,
    tabs: PAGES.map((name) => {
      const tab = tabbar.querySelector(`[data-tab="${name}"]`);
      return { width: tab.offsetWidth, height: tab.offsetHeight, left: tab.offsetLeft, top: tab.offsetTop };
    }),
  };
}

function load(name) {
  loaded.add(name);
  views[name].show();
}

function markTab(name) {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/** Makes `name` the current page. The pages sit side by side; `scroll` brings this one into view. */
function activate(name, { scroll = 'smooth' } = {}) {
  if (current && current !== name) views[current].hide?.();
  current = name;
  markTab(name);
  history.replaceState(null, '', `#${name}`);
  document.title = `${TITLES[name]} · Pantry Scoop`;
  document.body.dataset.page = name;
  // Pages beside the current one stay rendered for swiping, but out of reach of focus and readers.
  for (const page of PAGES) pageOf(page).toggleAttribute('inert', page !== name);
  const left = PAGES.indexOf(name) * pager.clientWidth;
  if (scroll && Math.abs(pager.scrollLeft - left) > 1) {
    heading = scroll === 'smooth' && !calm() ? name : undefined;
    pager.scrollTo?.({ left, behavior: heading ? 'smooth' : 'instant' });
  }
  load(name);
  paintSlide();
}

/**
 * Ties the motion to the finger: the tab highlight glides between tabs, the pages ease back and
 * fade a little as they leave the middle, and the pantry's search button fades with its page
 * (it keeps its place in the header, so the other buttons never jump).
 */
function paintSlide() {
  frame = 0;
  if (!signedIn) return;
  const { width, tabs } = slideLayout ??= measureSlide();
  const position = Math.min(PAGES.length - 1, Math.max(0, pager.scrollLeft / width));
  const from = tabs[Math.floor(position)], to = tabs[Math.ceil(position)], t = position - Math.floor(position);
  const mix = (a, b) => a + (b - a) * t;
  const still = calm();
  // Read all page geometry before writing styles. Interleaving these phases forces layout
  // repeatedly during a swipe, even when the animated property itself is a transform.
  const pages = PAGES.map((name, i) => {
    const page = pageOf(name), away = still ? 0 : Math.min(1, Math.abs(i - position));
    return { view: page.firstElementChild, away, origin: away ? `50% ${page.scrollTop + page.clientHeight * 0.4}px` : '' };
  });
  indicator.style.width = `${tabs[0].width}px`;
  indicator.style.height = `${tabs[0].height}px`;
  indicator.style.transform = `translate(${mix(from.left, to.left)}px, ${mix(from.top, to.top)}px) scale(${mix(from.width, to.width) / (tabs[0].width || 1)}, ${mix(from.height, to.height) / (tabs[0].height || 1)})`;
  // The view inside each page moves, never the page: snapping measures the page's transformed box.
  pages.forEach(({ view, away, origin }) => {
    view.style.transformOrigin = origin;
    view.style.transform = away ? `scale(${1 - 0.07 * away})` : '';
    view.style.opacity = away ? String(1 - 0.45 * away) : '';
  });
  const search = document.querySelector('.pantry-search-toggle');
  if (search) {
    const shown = Math.max(0, 1 - position);
    search.style.opacity = String(shown);
    search.style.scale = String(0.6 + 0.4 * shown);
    search.style.visibility = shown > 0.05 ? '' : 'hidden';
  }
}

const requestPaint = () => { frame ||= requestAnimationFrame(paintSlide); };

const pageVisibility = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting, intersectionRect } of entries) {
    target.dataset.inViewport = String(isIntersecting && intersectionRect.width > 1);
  }
}, { root: pager, threshold: [0, 0.01] });
for (const name of PAGES) pageVisibility.observe(pageOf(name));
const navigationSize = new ResizeObserver(() => { slideLayout = undefined; requestPaint(); });
navigationSize.observe(tabbar);
for (const tab of tabbar.querySelectorAll('[data-tab]')) navigationSize.observe(tab);

/** The page under the finger lights its tab at once and becomes current when the scroll comes to rest. */
function onPagerScroll() {
  const position = pager.scrollLeft / (pager.clientWidth || 1);
  if (!heading) markTab(PAGES[Math.round(position)]);
  requestPaint();
  // A page coming into view fills before it arrives, not after.
  for (const name of [PAGES[Math.floor(position)], PAGES[Math.ceil(position)]]) if (name && !loaded.has(name)) load(name);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 150);
}

function settle() {
  clearTimeout(settleTimer);
  if (!signedIn) return;
  const name = PAGES[Math.round(pager.scrollLeft / (pager.clientWidth || 1))];
  heading = undefined;
  if (name && name !== current) activate(name, { scroll: false });
  else markTab(current);
}

function showLogin({ consent = false, providerOnly } = {}) {
  views?.stock.hide();
  views?.recipes.stop();
  loading.hidden = true;
  signedIn = false;
  document.body.dataset.page = 'login';
  document.body.classList.remove('shell');
  document.title = t('Pantry Scoop — Your everyday kitchen companion');
  pager.hidden = true;
  tabbar.hidden = true;
  accountRoot.replaceChildren();
  loginRoot.replaceChildren();
  createLoginView(loginRoot, { consent, mode, providerOnly, google: providerOnly !== 'chatgpt' && google, onSignedIn: () => location.reload() });
  loginRoot.hidden = false;
}

function showApp(account, profile) {
  loading.hidden = true;
  signedIn = true;
  loginRoot.hidden = true;
  tabbar.hidden = false;
  document.body.classList.add('shell');
  pager.hidden = false;
  renderAccount(accountRoot, account, {
    mode,
    onSignedOut: () => showLogin(),
    onEnablePlan: () => showLogin({ consent: true }),
    onRestoreDefaults: async () => { if (await views.profile.restoreDefaults()) activate('profile'); },
  });
  views ??= {
    stock: createStockView(document.getElementById('view-stock')),
    recipes: createRecipesView(document.getElementById('view-recipes')),
    shopping: createShoppingView(document.getElementById('view-shopping')),
    profile: createProfileView(document.getElementById('view-profile'), { onSetupComplete: () => { location.hash = 'stock'; if (account.showPlanWelcome) showPlanWelcome(); } }),
  };
  const initial = location.hash.slice(1);
  current = undefined;
  activate(profile.setupComplete === false ? 'profile' : Object.hasOwn(views, initial) ? initial : 'stock', { scroll: 'instant' });
  if (document.body.dataset.page !== 'recipes') views.recipes.resume();
  if (account.showPlanWelcome && profile.setupComplete !== false) showPlanWelcome();
  // Fill the other pages while the browser is idle, so a swipe never reveals an empty page.
  window.requestIdleCallback?.(() => { for (const name of PAGES) if (!loaded.has(name)) load(name); }, { timeout: 2000 });
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => { location.hash = tab.dataset.tab; });
}
pager.addEventListener('scroll', onPagerScroll, { passive: true });
pager.addEventListener('scrollend', settle);
// Keep the current page in place when the window (and so every page) changes width.
let pagerWidth = 0;
if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
  if (!signedIn || pager.clientWidth === pagerWidth) return;
  pagerWidth = pager.clientWidth;
  slideLayout = undefined;
  pager.scrollTo?.({ left: PAGES.indexOf(current) * pagerWidth, behavior: 'instant' });
  paintSlide();
}).observe(pager);
window.addEventListener(SIGNED_OUT_EVENT, () => showLogin());
// A QR link opened in a tab that already shows the app only changes the hash: start over.
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#link=')) location.reload();
  else if (signedIn) {
    const name = location.hash.slice(1);
    activate(Object.hasOwn(views, name) ? name : 'stock');
  }
});

/**
 * The account's recipe language and the interface language are one setting. A language picked on
 * the sign-in screen is saved to the account; otherwise the account's language wins on this device.
 * Returns true when the page reloads into another language.
 */
async function syncLanguage(profile) {
  const picked = pendingLanguage();
  if (picked) {
    clearPendingLanguage();
    if (languageOfText(profile.language) !== picked) {
      profile.language = recipeLanguage(picked);
      await api.updateProfile({ language: profile.language }).catch(() => {});
    }
    return false;
  }
  const saved = languageOfText(profile.language);
  return !!saved && saved !== locale && setLanguage(saved);
}

/** Opened from the QR code shown on a signed-in computer: #link=<one-time token>. */
async function consumeDeviceLink() {
  const token = new URLSearchParams(location.hash.slice(1)).get('link');
  if (!token) return;
  history.replaceState(null, '', location.pathname);
  try {
    await api.signInWithDeviceLink(token);
  } catch (error) {
    alert(t(error.message));
  }
}

try {
  const config = await api.getAuthConfig();
  ({ mode, google = false } = config);
  if (!platform.native && config.mobilePending && !config.mobileAuthenticated) {
    showLogin({ consent: config.mobileConsent, providerOnly: config.mobileProvider });
  } else {
    await consumeDeviceLink();
    const account = await api.getAccount();
    if (!platform.native && config.mobilePending) {
      location.replace('/auth/mobile/finish');
    } else {
      const { profile } = await api.getProfile();
      if (!(await syncLanguage(profile))) showApp(account, profile);
    }
  }
} catch (error) {
  if (error.code !== 'auth-required') {
    loading.hidden = true;
    loginRoot.replaceChildren(h('div', { class: 'empty-state' }, h('h1', {}, t('Your kitchen is taking a moment.')), h('p', { class: 'problem', role: 'alert' }, error.message), h('button', { class: 'primary', onclick: () => location.reload() }, t('Try again'))));
    loginRoot.hidden = false;
  }
}
