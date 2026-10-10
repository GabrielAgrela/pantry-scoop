import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shoppingList } from '../../public/js/shopping-list.js';

const pantry = [
  { id: 1, name: 'Leite', emoji: '🥛', inStock: true },
  { id: 2, name: 'Ovos', emoji: '🥚', inStock: false },
  { id: 3, name: 'Manteiga', emoji: '🧈', inStock: false },
];
const recipe = (title, ingredients) => ({ title, ingredients });
const crepes = { id: 10, recipe: recipe('Crepes', [
  { name: 'Leite', amount: '300 ml', inStock: true, pantryId: 1 },
  { name: 'Ovos', amount: '2', inStock: false, pantryId: 2 },
  { name: 'Farinha', amount: '150 g', inStock: false, emoji: '🌾' },
]) };
const bolo = { id: 11, recipe: recipe('Bolo', [
  { name: 'farinha ', amount: '200 g', inStock: false },
  { name: 'Açúcar', amount: '', inStock: false },
]) };
const names = (entries) => entries.map((entry) => entry.name);

describe('shopping list', () => {
  it('lists run-out pantry items and what saved recipes need that the pantry has never had', () => {
    const list = shoppingList({ pantry, saved: [crepes, bolo] });
    assert.deepEqual(list.restock.map((item) => [item.name, item.pantryId, item.recipes.map((need) => need.title)]),
      [['Ovos', 2, ['Crepes']], ['Manteiga', 3, []]]);
    assert.deepEqual(list.forRecipes.map((item) => [item.name, item.pantryId, item.recipes]), [
      ['Farinha', undefined, [{ id: 'saved:10', title: 'Crepes', amount: '150 g', idea: false }, { id: 'saved:11', title: 'Bolo', amount: '200 g', idea: false }]],
      ['Açúcar', undefined, [{ id: 'saved:11', title: 'Bolo', amount: '', idea: false }]],
    ]);
    assert.deepEqual([list.mine, list.hidden], [[], []]);
  });

  it('shows names, titles and amounts the way the cook reads them', () => {
    const english = recipe('Pancakes', [{ name: 'Flour', amount: '150 g', inStock: false }]);
    const list = shoppingList({ pantry: [], saved: [{ id: 1, recipe: english }] }, () => recipe('Panquecas', [{ name: 'Farinha', amount: '150 g' }]));
    assert.deepEqual(list.forRecipes.map((item) => [item.name, item.recipes[0].title]), [['Farinha', 'Panquecas']]);
  });

  it('names a recipe once per item even when it lists the item twice', () => {
    const list = shoppingList({ pantry: [], saved: [{ id: 1, recipe: recipe('Tart', [
      { name: 'Sugar', amount: '50 g', inStock: false },
      { name: 'Sugar', amount: 'to dust', inStock: false },
    ]) }] });
    assert.deepEqual(list.forRecipes[0].recipes, [{ id: 'saved:1', title: 'Tart', amount: '50 g', idea: false }]);
  });

  it('lists hand-added items first, folding one into an entry that already has its name', () => {
    const items = [{ id: 7, name: 'Arroz', emoji: '🍚' }, { id: 8, name: 'OVOS', emoji: '🥚' }, { id: 9, name: 'farinha', emoji: '🌾' }];
    const list = shoppingList({ pantry, saved: [crepes], items });
    assert.deepEqual(list.mine.map((item) => [item.key, item.name, item.itemId]), [['item:7', 'Arroz', 7]]);
    assert.deepEqual(list.restock.map((item) => [item.name, item.itemId]), [['Ovos', 8], ['Manteiga', undefined]]);
    assert.deepEqual(list.forRecipes.map((item) => [item.name, item.itemId]), [['Farinha', 9]]);
  });

  it('hides what the cook doesn’t need until a new recipe or the cook asks for it again', () => {
    const hidden = [
      { id: 1, key: 'pantry:3', recipeIds: [] },
      { id: 2, key: 'new:farinha', recipeIds: ['saved:10'] },
      { id: 3, key: 'new:acucar', recipeIds: ['saved:11'] },
      { id: 4, key: 'new:sal', recipeIds: [] },
    ];
    const list = shoppingList({ pantry, saved: [crepes, bolo], hidden });
    assert.deepEqual(names(list.restock), ['Ovos']);
    assert.deepEqual(names(list.forRecipes), ['Farinha'], 'Bolo needs flour too, and flour was only hidden for Crepes');
    assert.deepEqual(list.hidden.map((entry) => [entry.name, entry.hiddenId]), [['Manteiga', 1], ['Açúcar', 3]]);

    const added = shoppingList({ pantry, saved: [crepes, bolo], hidden, items: [{ id: 5, name: 'Manteiga', emoji: '🧈' }] });
    assert.deepEqual(names(added.restock), ['Ovos', 'Manteiga'], 'adding it by hand brings it back');
  });

  it('adds what the latest ideas need, counting an idea once it is saved as a saved recipe', () => {
    const ideas = { id: 40, recipes: [
      recipe('Omelete', [{ name: 'Ovos', amount: '3', inStock: false, pantryId: 2 }, { name: 'Queijo', amount: '50 g', inStock: false }]),
      recipe('crepes', [{ name: 'Farinha', amount: '150 g', inStock: false }]),
    ] };
    const list = shoppingList({ pantry, saved: [crepes], ideas });
    assert.deepEqual(list.restock[0].recipes, [
      { id: 'saved:10', title: 'Crepes', amount: '2', idea: false },
      { id: 'idea:40:0', title: 'Omelete', amount: '3', idea: true },
    ]);
    assert.deepEqual(list.forRecipes.map((item) => [item.name, item.recipes.map((need) => need.id)]), [['Farinha', ['saved:10']], ['Queijo', ['idea:40:0']]]);

    const hidden = shoppingList({ pantry, saved: [crepes], ideas, hidden: [{ id: 1, key: 'new:queijo', recipeIds: ['idea:40:0'] }] });
    assert.deepEqual(names(hidden.forRecipes), ['Farinha']);
    const nextBatch = shoppingList({ pantry, saved: [crepes], ideas: { ...ideas, id: 41 }, hidden: [{ id: 1, key: 'new:queijo', recipeIds: ['idea:40:0'] }] });
    assert.deepEqual(names(nextBatch.forRecipes), ['Farinha', 'Queijo'], 'a new batch asking for it brings it back');
  });
});
