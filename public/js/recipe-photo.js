/** Editorial illustrations for these dish families, not photos of a generated recipe. */
export function recipePhoto(recipe) {
  const title = recipe.title.toLowerCase();
  if (/pasta|spaghetti|linguine|fettuccine|tagliatelle|massa/.test(title)) return '/assets/lemon-spinach-pasta.webp';
  if (/shakshuka|tomato.*egg|egg.*tomato|tomate.*ovo|ovo.*tomate/.test(title)) return '/assets/tomato-egg-skillet.webp';
}
