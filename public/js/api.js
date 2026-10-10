import { LANGUAGE_HEADER, locale, t, translateMessage } from './i18n.js';

/** Error from the API, carrying the server's machine-readable `code` (e.g. "usage-limit"). */
export class ApiError extends Error {
  constructor(message, { status, code, manageUsageUrl } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.manageUsageUrl = manageUsageUrl;
  }
}

/** Fired when any call finds the session gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = 'pantry:signed-out';
export const PANTRY_CHANGED_EVENT = 'pantry:stock-changed';

/** Single place that knows the HTTP API's shape. */
async function request(method, url, body, { keepalive = false } = {}) {
  const response = await fetch(url, {
    method,
    headers: { [LANGUAGE_HEADER]: locale, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
  });
  const notifyStockChange = () => {
    if (response.ok && method !== 'GET' && (url.startsWith('/api/ingredients') || /^\/api\/(scan\/\d+\/confirm|shopping\/items\/\d+\/bought)$/.test(url))) window.dispatchEvent(new CustomEvent(PANTRY_CHANGED_EVENT));
  };
  if (response.status === 204) { notifyStockChange(); return undefined; }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Server messages are English; the ones the dictionary knows are shown translated.
    const error = new ApiError(data.error ? translateMessage(data.error) : t('Request failed ({status})', { status: response.status }), { status: response.status, ...data });
    // A failed sign-in attempt is reported where it happened, not as "your session ended".
    if (error.code === 'auth-required' && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: error }));
    }
    throw error;
  }
  notifyStockChange();
  return data;
}

export const api = {
  getAuthConfig: () => request('GET', '/api/auth/config'),
  getAccount: () => request('GET', '/api/account'),
  listModels: () => request('GET', '/api/account/models'),
  getAiUsage: () => request('GET', '/api/account/usage'),
  setModel: (model) => request('PUT', '/api/account/model', { model }),
  dismissPlanWelcome: () => request('POST', '/api/account/plan-welcome/dismiss'),
  completeSignIn: (callbackUrl) => request('POST', '/api/auth/complete', { callbackUrl }),
  createDeviceLink: () => request('POST', '/api/account/device-links'),
  signInWithDeviceLink: (token) => request('POST', '/api/auth/device-link', { token }),
  signOut: () => request('POST', '/api/auth/sign-out'),
  deleteAccount: () => request('DELETE', '/api/account'),
  getConnections: () => request('GET', '/api/connections'),
  setAi: (provider) => request('PUT', '/api/connections/ai', { provider }),
  disconnect: (provider) => request('POST', '/api/connections/disconnect', { provider }),

  classifyOther: () => request('POST', '/api/ingredients/classify-other', {}),
  listIngredients: () => request('GET', '/api/ingredients'),
  getPantryBasics: () => request('GET', '/api/ingredients/basics'),
  savePantryBasics: (selected) => request('POST', '/api/ingredients/basics', { selected }),
  addIngredient: (ingredient) => request('POST', '/api/ingredients', ingredient),
  updateIngredient: (id, changes) => request('PATCH', `/api/ingredients/${id}`, changes),
  deleteIngredient: (id) => request('DELETE', `/api/ingredients/${id}`),
  scan: (images) => request('POST', '/api/scan', { images }),
  confirmScan: (id, ingredients) => request('POST', `/api/scan/${id}/confirm`, { ingredients }),
  appendScan: (id, images) => request('POST', `/api/scan/${id}/photos`, { images }),
  listJobs: (kind, limit = 5) => request('GET', `/api/jobs?kind=${kind}&limit=${limit}`),
  getJob: (id) => request('GET', `/api/jobs/${id}`),

  suggestRecipes: (options) => request('POST', '/api/recipes/suggestions', options),
  earlierIdeas: (options) => request('POST', '/api/recipes/suggestions/earlier', options),
  askRecipe: (recipe, question, history) => request('POST', '/api/recipes/ask', { recipe, question, history }),
  listSavedRecipes: () => request('GET', '/api/recipes/saved'),
  translateRecipes: (batches) => request('POST', '/api/recipes/translate', { batches }),
  recipeHistory: (before, search = '') => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (search) params.set('search', search);
    return request('GET', `/api/recipes/history${params.size ? `?${params}` : ''}`);
  },
  clearRecipeHistory: () => request('DELETE', '/api/recipes/history'),
  saveRecipe: (recipe) => request('POST', '/api/recipes/saved', { recipe }),
  deleteSavedRecipe: (id) => request('DELETE', `/api/recipes/saved/${id}`),
  cookedRecipe: (recipe, ranOut) => request('POST', '/api/recipes/cooked', { recipe, ranOut }),
  recipeFeedback: (recipe, feedback, history = [], proposed = []) => request('POST', '/api/recipes/feedback', { recipe, feedback, history, proposed }),
  listMemories: () => request('GET', '/api/recipes/memories'),
  remember: (notes, recipeTitle) => request('POST', '/api/recipes/memories', { notes, recipeTitle }),
  editMemory: (id, note) => request('PATCH', `/api/recipes/memories/${id}`, { note }),
  forgetMemory: (id) => request('DELETE', `/api/recipes/memories/${id}`),
  forgetAllMemories: () => request('DELETE', '/api/recipes/memories'),

  getShopping: () => request('GET', '/api/shopping'),
  addShoppingItem: (name) => request('POST', '/api/shopping/items', { name }),
  removeShoppingItem: (id) => request('DELETE', `/api/shopping/items/${id}`),
  boughtShoppingItem: (id) => request('POST', `/api/shopping/items/${id}/bought`),
  hideShoppingItem: (key, recipeIds) => request('POST', '/api/shopping/hidden', { key, recipeIds }),
  unhideShoppingItem: (id) => request('DELETE', `/api/shopping/hidden/${id}`),
  unhideAllShopping: () => request('DELETE', '/api/shopping/hidden'),

  getProfile: () => request('GET', '/api/profile'),
  updateProfile: (profile, options) => request('PUT', '/api/profile', profile, options),
  resetProfile: () => request('POST', '/api/profile/reset'),
};
