import { ValidationError } from './errors.ts';
import type { Category } from './ingredient.ts';

/** Starting suggestions only; stock is created after the user reviews them. */
export const PANTRY_BASICS: readonly { name: string; category: Category; emoji: string }[] = [
  { name: 'Water', category: 'drinks', emoji: '💧' },
  { name: 'Salt', category: 'herbs-spices', emoji: '🧂' },
  { name: 'Black pepper', category: 'herbs-spices', emoji: '🌶️' },
  { name: 'Eggs', category: 'eggs', emoji: '🥚' },
  { name: 'Milk', category: 'dairy', emoji: '🥛' },
  { name: 'Olive oil', category: 'condiments', emoji: '🫒' },
  { name: 'Flour', category: 'baking', emoji: '🌾' },
  { name: 'Sugar', category: 'sweetener', emoji: '🍬' },
  { name: 'Rice', category: 'grains', emoji: '🍚' },
];

export function pantryBasicsSelection(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PANTRY_BASICS.length ||
    value.some(name => typeof name !== 'string' || !PANTRY_BASICS.some(item => item.name === name))) {
    throw new ValidationError('Choose pantry basics from the suggested items.');
  }
  return [...new Set(value as string[])];
}
