import { t } from './i18n.js';

/** Display names for the server's category ids. */
export const CATEGORY_LABELS = {
  dairy: t('Dairy'),
  eggs: t('Eggs'),
  'meat-fish': t('Meat & fish'),
  vegetables: t('Vegetables'),
  fruit: t('Fruit'),
  grains: t('Grains & pasta'),
  legumes: t('Legumes'),
  nuts: t('Nuts & seeds'),
  'herbs-spices': t('Herbs & spices'),
  flavouring: t('Flavourings'),
  condiments: t('Sauces & oils'),
  baking: t('Baking'),
  sweetener: t('Sweeteners'),
  chocolate: t('Chocolate & sweets'),
  snacks: t('Snacks'),
  drinks: t('Drinks'),
  alcohol: t('Alcohol'),
  other: t('Other'),
};

export const categoryLabel = (id) => CATEGORY_LABELS[id] ?? (id.startsWith('custom:') ? id.slice(7) : id);

export const SHELF_EMOJIS = {
  produce: '🥑', 'dairy-eggs': '🥛', 'meat-fish': '🐟', grains: '🍝', legumes: '🫘',
  nuts: '🥜', 'herbs-spices': '🌿', flavouring: '🍋', condiments: '🫙', baking: '🥐',
  sweetener: '🍯', chocolate: '🍫', snacks: '🍿', drinks: '🫖', alcohol: '🍷', other: '🧺',
};

/** Display shelves combine closely related categories without changing stored ingredient data. */
export const SHELVES = [
  { id: 'produce', label: t('Produce'), categories: ['vegetables', 'fruit'] },
  { id: 'dairy-eggs', label: t('Dairy & eggs'), categories: ['dairy', 'eggs'] },
  ...Object.keys(CATEGORY_LABELS).filter((id) => !['vegetables', 'fruit', 'dairy', 'eggs'].includes(id)).map((id) => ({ id, label: CATEGORY_LABELS[id], categories: [id] })),
];

/** Custom categories are persisted on ingredients and appear throughout the pantry. */
export function shelvesFor(categories) {
  const custom = categories.filter((id) => id.startsWith('custom:')).map((id) => ({ id, label: categoryLabel(id), categories: [id] }));
  return [...SHELVES.filter((shelf) => shelf.id !== 'other'), ...custom, SHELVES.find((shelf) => shelf.id === 'other')];
}
