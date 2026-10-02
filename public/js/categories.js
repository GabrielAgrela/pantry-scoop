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
