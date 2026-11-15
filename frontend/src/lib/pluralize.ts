const SPANISH_VOWELS = /[aeiouáéíóú]$/i;

/**
 * Regular Spanish plural: vowel ending takes "s", anything else takes "es".
 * Accents are not inferred; irregular or accented words pass an explicit plural.
 */
export function pluralizeEs(word: string): string {
  if (!word) return word;
  return SPANISH_VOWELS.test(word) ? `${word}s` : `${word}es`;
}
