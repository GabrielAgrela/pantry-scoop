/** Same key as the server's normalizeName: case-, accent- and whitespace-insensitive. */
export const nameKey = (name) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * What to buy: what the cook added by hand (`items`), pantry items that ran out, and what saved
 * recipes and the latest batch of ideas need that the pantry has never had. `saved` are saved
 * recipes and `ideas` the latest idea batch ({ id, recipes }), as the server lists them (stock already
 * matched); `readable` gives the text the cook reads, so names, titles and amounts appear in their
 * language. Each entry lists the recipes that need it, with their amounts.
 *
 * `hidden` are entries the cook doesn't need. One stays hidden until a recipe it wasn't hidden
 * for asks for it, or the cook adds it by hand. Hidden entries come back separately, so they can be
 * counted and shown again.
 */
export function shoppingList({ pantry, saved, ideas, items = [], hidden = [] }, readable = (recipe) => recipe) {
  const restock = new Map(pantry.filter((item) => !item.inStock)
    .map((item) => [item.id, { key: `pantry:${item.id}`, name: item.name, emoji: item.emoji, pantryId: item.id, recipes: [] }]));
  const fresh = new Map();
  const savedTitles = new Set(saved.map(({ recipe }) => nameKey(recipe.title)));
  const recipes = [
    ...saved.map(({ id, recipe }) => ({ id: `saved:${id}`, recipe })),
    // An idea the cook saved already counts as a saved recipe.
    ...(ideas?.recipes ?? []).map((recipe, index) => ({ id: `idea:${ideas.id}:${index}`, recipe, idea: true }))
      .filter(({ recipe }) => !savedTitles.has(nameKey(recipe.title))),
  ];
  for (const { id, recipe, idea = false } of recipes) {
    const shown = readable(recipe);
    recipe.ingredients.forEach((ingredient, index) => {
      if (ingredient.inStock) return;
      const name = shown.ingredients[index]?.name ?? ingredient.name;
      const key = nameKey(name);
      const entry = restock.get(ingredient.pantryId) ?? fresh.get(key)
        ?? fresh.set(key, { key: `new:${key}`, name, emoji: ingredient.emoji, recipes: [] }).get(key);
      if (entry.recipes.some((need) => need.id === id)) return;
      entry.recipes.push({ id, title: shown.title, amount: shown.ingredients[index]?.amount ?? ingredient.amount, idea });
    });
  }
  // A hand-added item joins the entry with its name instead of repeating it.
  const byName = new Map([...restock.values(), ...fresh.values()].map((entry) => [nameKey(entry.name), entry]));
  const mine = [];
  for (const item of items) {
    const twin = byName.get(nameKey(item.name));
    if (twin) twin.itemId = item.id;
    else mine.push({ key: `item:${item.id}`, name: item.name, emoji: item.emoji, itemId: item.id, recipes: [] });
  }
  const hiddenByKey = new Map(hidden.map((entry) => [entry.key, entry]));
  const hiddenEntries = [];
  const visible = (entry) => {
    const rule = hiddenByKey.get(entry.key);
    if (!rule || entry.itemId !== undefined || !entry.recipes.every((need) => rule.recipeIds.includes(need.id))) return true;
    hiddenEntries.push({ ...entry, hiddenId: rule.id });
    return false;
  };
  const order = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  // What the most recipes are waiting for comes first; then alphabetical.
  const sorted = (entries) => [...entries].filter(visible).sort((a, b) => b.recipes.length - a.recipes.length || order.compare(a.name, b.name));
  return { mine, restock: sorted(restock.values()), forRecipes: sorted(fresh.values()), hidden: hiddenEntries };
}

/** Every entry still to buy, in the order the list shows them. */
export const toBuy = ({ mine, restock, forRecipes }) => [...mine, ...restock, ...forRecipes];
