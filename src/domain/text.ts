/**
 * Canonical key for comparing user-facing names: case-, accent- and whitespace-insensitive
 * ("Leite  Magro" === "leite magro" === "LEITE MAGRÓ").
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
