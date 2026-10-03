/** Display names for the server's category ids. */
export const CATEGORY_LABELS = {
  dairy: 'Dairy',
  eggs: 'Eggs',
  'meat-fish': 'Meat & fish',
  vegetables: 'Vegetables',
  fruit: 'Fruit',
  grains: 'Grains & pasta',
  legumes: 'Legumes',
  nuts: 'Nuts & seeds',
  'herbs-spices': 'Herbs & spices',
  flavouring: 'Flavourings',
  condiments: 'Sauces & oils',
  baking: 'Baking',
  sweetener: 'Sweeteners',
  chocolate: 'Chocolate & sweets',
  snacks: 'Snacks',
  drinks: 'Drinks',
  alcohol: 'Alcohol',
  other: 'Other',
};

export const categoryLabel = (id) => CATEGORY_LABELS[id] ?? id;

/** Display shelves combine closely related categories without changing stored ingredient data. */
export const SHELVES = [
  { id: 'produce', label: 'Produce', categories: ['vegetables', 'fruit'] },
  { id: 'dairy-eggs', label: 'Dairy & eggs', categories: ['dairy', 'eggs'] },
  ...Object.keys(CATEGORY_LABELS).filter((id) => !['vegetables', 'fruit', 'dairy', 'eggs'].includes(id)).map((id) => ({ id, label: CATEGORY_LABELS[id], categories: [id] })),
];
