import { renderAccount, showPlanWelcome } from './account.js';
import { api, SIGNED_OUT_EVENT } from './api.js';
import { createLoginView } from './views/login.js';
import { createProfileView } from './views/profile.js';
import { createRecipesView } from './views/recipes.js';
import { createStockView } from './views/stock.js';
import { h } from './dom.js';
import { platform } from './platform.js';

const loginRoot = document.getElementById('view-login');
const accountRoot = document.getElementById('account');
const tabbar = document.querySelector('.tabbar');
const loading = document.getElementById('app-loading');
const pager = document.querySelector('.pages');
const PAGES = ['stock', 'recipes', 'profile'];
const TITLES = { stock: 'My pantry', recipes: 'Recipes', profile: 'My kitchen' };
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
  const position = Math.min(PAGES.length - 1, Math.max(0, pager.scrollLeft / (pager.clientWidth || 1)));
  const tabs = PAGES.map((name) => tabbar.querySelector(`[data-tab="${name}"]`));
  const from = tabs[Math.floor(position)], to = tabs[Math.ceil(position)], t = position - Math.floor(position);
  const mix = (a, b) => a + (b - a) * t;
  indicator.style.width = `${mix(from.offsetWidth, to.offsetWidth)}px`;
  indicator.style.height = `${from.offsetHeight}px`;
  indicator.style.transform = `translate(${mix(from.offsetLeft, to.offsetLeft)}px, ${from.offsetTop}px)`;
  const still = calm();
  // The view inside each page moves, never the page: snapping measures the page's transformed box.
  PAGES.forEach((name, i) => {
    const away = still ? 0 : Math.min(1, Math.abs(i - position));
    const page = pageOf(name), view = page.firstElementChild;
    view.style.transformOrigin = away ? `50% ${page.scrollTop + page.clientHeight * 0.4}px` : '';
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
  document.title = 'Pantry Scoop — Your everyday kitchen companion';
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

/** Opened from the QR code shown on a signed-in computer: #link=<one-time token>. */
async function consumeDeviceLink() {
  const token = new URLSearchParams(location.hash.slice(1)).get('link');
  if (!token) return;
  history.replaceState(null, '', location.pathname);
  try {
    await api.signInWithDeviceLink(token);
  } catch (error) {
    alert(error.message);
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
      showApp(account, profile);
    }
  }
} catch (error) {
  if (error.code !== 'auth-required') {
    loading.hidden = true;
    loginRoot.replaceChildren(h('div', { class: 'empty-state' }, h('h1', {}, 'Your kitchen is taking a moment.'), h('p', { class: 'problem', role: 'alert' }, error.message), h('button', { class: 'primary', onclick: () => location.reload() }, 'Try again')));
    loginRoot.hidden = false;
  }
}
