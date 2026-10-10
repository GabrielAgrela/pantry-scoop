import { h } from './dom.js';

const paths = {
  microphone: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z', 'M5 10v2a7 7 0 0 0 14 0v-2', 'M12 19v3', 'M8 22h8'],
  speaker: ['M3 9h4l5-4v14l-5-4H3Z', 'M16 8a6 6 0 0 1 0 8', 'M19 5a10 10 0 0 1 0 14'],
  muted: ['M3 9h4l5-4v14l-5-4H3Z', 'M17 9l5 6', 'M22 9l-5 6'],
  stop: ['M6 6h12v12H6Z'],
  sort: ['M8 4v16', 'm4 8 4-4 4 4', 'M16 4v16', 'm12 16 4 4 4-4'],
  unlink: ['M9 15l-2 2a4 4 0 0 1-6-6l2-2', 'm15 9 2-2a4 4 0 0 1 6 6l-2 2', 'M8 2v3', 'M2 8h3', 'M16 19v3', 'M19 16h3', 'm10 14 4-4'],
  trash: ['M3 6h18', 'M9 6V3h6v3', 'm5 6 1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
  link: ['m10 13 4-4', 'M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0', 'm16 9 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'],
  edit: ['m16 3 5 5-12 12-6 1 1-6Z', 'm14 5 5 5'],
  chevron: ['m9 5 7 7-7 7'],
  back: ['m15 5-7 7 7 7'],
  people: ['M15 21v-3a4 4 0 0 0-8 0v3', 'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M19 8a3 3 0 0 1 0 6', 'M20 21v-3a4 4 0 0 0-2-3.5'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M3 12h18', 'M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
  scale: ['M5 4h14', 'M12 4v4', 'm7 8-3 12h16L17 8Z', 'M12 13v3'],
  airfryer: ['M6 3h12l2 5v13H4V8Z', 'M4 8h16', 'M10 12h4v5h-4Z', 'M10 5h4'],
  appliance: ['M6 8h12l2 12H4Z', 'M3 8h18', 'M7 8V6a5 5 0 0 1 10 0v2', 'M10 4h4'],
  jar: ['M7 7h10l2 4v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9z', 'M7 3h10v4H7z', 'M9 17c0-4 6-5 6-5s0 6-6 5Z', 'M9 17l5-4'],
  pantry: ['M7 3h10v4H7Z', 'M7 7h10l2 4v9H5v-9Z', 'M5 11h14'],
  recipes: ['M4 3v7a3 3 0 0 0 6 0V3', 'M7 3v18', 'M18 3v18', 'M18 3c-3 2-3 7 0 8'],
  kitchen: ['M4 8h16l-2 12H6Z', 'M2 8h20', 'M8 5h8', 'M10 3h4', 'M6 8V5h12v3'],
  camera: ['M3 7h4l2-3h6l2 3h4v13H3z', 'M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  image: ['M3 3h18v18H3z', 'M3 17l6-6 4 4 3-3 5 5', 'M16 7h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm15 15 6 6'],
  arrow: ['M4 12h16', 'm14 6 6 6-6 6'],
  leaf: ['M5 19C1 9 11 3 21 3c0 10-6 20-16 16Z', 'M5 19 16 8'],
  spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z'],
  check: ['m5 12 4 4L19 6'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 7v5l3 2'],
  bookmark: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'],
  bowl: ['M3 11h18c0 6-4 9-9 9s-9-3-9-9Z', 'M8 3v4', 'M12 2v5', 'M16 3v4'],
  settings: ['M4 7h16', 'M4 17h16', 'M8 4v6', 'M16 14v6'],
  phone: ['M7 2h10v20H7Z', 'M11 18h2'],
  reset: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  signout: ['M14 4h6v16h-6', 'M10 12h10', 'm7 8-4 4 4 4'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
};

/** Small, local vector icons; user content is always rendered with the text-safe builder. */
export function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `ui-icon ${className}` })) svg.setAttribute(key, value);
  for (const d of paths[name] ?? paths.leaf) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : '');

/** Decorative accents stay out of screen reader labels. */
export const emoji = (symbol, className = '') => h('span', { class: `emoji ${className}`, 'aria-hidden': 'true' }, symbol);

/** A small illustrated pantry friend; all decoration is hidden from assistive tech. */
export const pantryFriend = (className = '') => h('span', { class: `pantry-friend ${className}`, 'aria-hidden': 'true' }, h('img', { src: '/assets/scoop-jar.svg', alt: '', width: 96, height: 112 }));

/** Scoop, the guide, saying something in a speech bubble; only the words reach assistive tech. */
export const scoopSays = (content, className = '') => h('div', { class: `scoop-says ${className}`.trim() },
  h('img', { class: 'scoop-says-face', src: '/assets/scoop-guide.svg', alt: '', width: 56, height: 60, 'aria-hidden': 'true' }),
  h('p', { class: 'scoop-says-bubble' }, content));

export const emptyState = (symbol, title, copy) => h('div', { class: 'empty-state' },
  h('div', { class: 'empty-art', 'aria-hidden': 'true' }, pantryFriend(), emoji(symbol, 'empty-companion')),
  h('h3', {}, title), h('p', {}, copy));

export function dishEmoji(value) {
  // Dish names may be in any of the app's languages, so the patterns include their words too.
  const name = value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  for (const [pattern, symbol] of [[/ice.?cream|gelado|helado|glace|sorbet|sorvete/, '🍨'], [/cake|baking|bake|bolo|muffin|pastel|bizcocho|gateau|patisserie|reposteria|pastelaria/, '🧁'], [/cookie|biscuit|bolacha|galleta/, '🍪'], [/pasta|spaghetti|massa|noodle|pates/, '🍝'], [/salad|salada|ensalada|salade/, '🥗'], [/soup|sopa|stew|soupe|caldo|guisado|ragout/, '🍲'], [/egg|breakfast|frittata|omelette|ovo|pequeno.almoco|huevo|desayuno|oeuf|petit.dejeuner|tortilla/, '🍳'], [/dessert|chocolate|brownie|sobremesa|postre/, '🍰'], [/drink|smoothie|sumo|bebida|boisson|batido/, '🥤'], [/bread|toast|sandwich|pao|pan\b|pain|tosta|bocadillo/, '🥪'], [/pizza/, '🍕'], [/snack|lanche|petisco|aperitivo|merienda|tentempie|en.cas|gouter/, '🥨']]) {
    if (pattern.test(name)) return symbol;
  }
  return '🍽️';
}

export function applianceEmoji(value) {
  const name = value.normalize('NFD').replace(/\p{M}/gu, '');
  if (/ice.?cream|gelado|helad|glace|sorbet/i.test(name)) return '🍨';
  if (/freez|frigor|fridge|congel|nevera|refrigera|geladeira/i.test(name)) return '🧊';
  if (/blend|liquid|licuadora|batidora|mixeur/i.test(name)) return '🥤';
  if (/oven|forno|fryer|horno|four|friteuse|freidora|fritadeira/i.test(name)) return '🥐';
  if (/microwave|micro.?ondas|micro.?onde/i.test(name)) return '🍱';
  if (/hob|stove|fogao|placa|cocina|plaque|vitro|cuisiniere/i.test(name)) return '🍳';
  if (/kettle|tea|chaleira|hervidor|bouilloire|cha\b/i.test(name)) return '🫖';
  return '🥣';
}
