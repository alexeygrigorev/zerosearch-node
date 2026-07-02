/**
 * Optional English stemmers for zerosearch-node.
 *
 * A faithful, zero-dependency TypeScript port of the shared Python `stemlite`
 * library (https://github.com/alexeygrigorev/stemlite). The Porter algorithm
 * below mirrors `stemlite/porter.py` exactly — including its simplifications
 * (`y` is always treated as a vowel) and its double-consonant quirks — so that
 * the same input word produces the same stem in both languages. This keeps the
 * browser search path in agreement with a Python-built (Lambda) index.
 *
 * `getStemmer(name)` mirrors `stemlite.get_stemmer`: it returns a
 * `(word: string) => string` for a built-in name ('porter'), or a no-op
 * (lowercase-only) stemmer for `null`/unknown names.
 */

export type StemmerFn = (word: string) => string;

/** Vowels for the algorithm. Note: `y` is always a vowel here (matches Python). */
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

function isVowel(char: string): boolean {
  return VOWELS.has(char);
}

/** Whether a word contains any vowel. */
function containsVowel(word: string): boolean {
  for (const char of word) if (isVowel(char)) return true;
  return false;
}

/**
 * Calculate the measure of a word: the number of consonant->vowel->consonant
 * transitions, i.e. `m` in `[C](VC)^m[V]`.
 */
function measure(word: string): number {
  let count = 0;
  let prevWasVowel = false;
  for (const char of word) {
    const vowel = isVowel(char);
    if (!vowel && prevWasVowel) count += 1;
    prevWasVowel = vowel;
  }
  return count;
}

/** Whether the word ends with a double (identical) consonant. */
function endsDoubleConsonant(word: string): boolean {
  if (word.length < 2) return false;
  const last = word[word.length - 1];
  return last === word[word.length - 2] && !isVowel(last);
}

/** Whether the word ends with a consonant-vowel-consonant pattern. */
function endsCvc(word: string): boolean {
  if (word.length < 3) return false;
  const n = word.length;
  return !isVowel(word[n - 3]) && isVowel(word[n - 2]) && !isVowel(word[n - 1]);
}

/** Step 1a: handle plurals. */
function step1a(word: string): string {
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Step 1b: handle -eed, -ed, -ing endings. */
function step1b(word: string): string {
  if (word.endsWith("eed")) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) return stem + "ee";
    return word;
  }

  let hasEdIng = false;
  if (word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    if (containsVowel(stem)) {
      word = stem;
      hasEdIng = true;
    }
  } else if (word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    if (containsVowel(stem)) {
      word = stem;
      hasEdIng = true;
    }
  }

  if (hasEdIng) {
    if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
      return word + "e";
    }
    // Double consonant with m>1: drop the last consonant.
    if (endsDoubleConsonant(word) && measure(word) > 1) {
      return word.slice(0, -1);
    }
    // Special case: double consonant with m==1 still drops one (so "running"
    // -> "run"), as long as the word stays >= 3 chars. Mirrors the Python quirk.
    if (endsDoubleConsonant(word) && measure(word) === 1) {
      if (word.length >= 3) return word.slice(0, -1);
    }
    // m==1 and ends in cvc: add 'e'.
    if (measure(word) === 1 && endsCvc(word)) {
      return word + "e";
    }
  }

  return word;
}

/** Step 1c: handle -ive. */
function step1c(word: string): string {
  if (word.endsWith("ive")) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) return stem;
  }
  return word;
}

const STEP2_SUFFIXES: Array<[string, string]> = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
  ["fulli", "ful"],
];

function step2(word: string): string {
  for (const [suffix, replacement] of STEP2_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) return stem + replacement;
    }
  }
  return word;
}

const STEP3_SUFFIXES: Array<[string, string]> = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

function step3(word: string): string {
  for (const [suffix, replacement] of STEP3_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) return stem + replacement;
    }
  }
  return word;
}

const STEP4_SUFFIXES: Array<[string, string]> = [
  ["al", ""],
  ["ance", ""],
  ["ence", ""],
  ["er", ""],
  ["ic", ""],
  ["able", ""],
  ["ible", ""],
  ["ate", ""],
  ["ive", ""],
  ["ize", ""],
  ["ment", ""],
  ["ant", ""],
  ["ent", ""],
  ["ism", ""],
  ["ou", ""],
  ["tion", ""],
];

function step4(word: string): string {
  for (const [suffix, replacement] of STEP4_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 1) return stem + replacement;
    }
  }
  return word;
}

/** Step 5a: handle a final -e. */
function step5a(word: string): string {
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1) return stem;
    if (m === 1 && !endsCvc(stem)) return stem;
  }
  return word;
}

/** Step 5b: strip a final double consonant when m>1. */
function step5b(word: string): string {
  const m = measure(word);
  if (m > 1 && endsDoubleConsonant(word) && endsCvc(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Apply the Porter stemming algorithm to a single word, returning it lowercased
 * and stemmed. Faithfully mirrors `stemlite.porter.porter_stemmer`.
 */
export function porterStemmer(word: string): string {
  if (!word) return "";
  word = word.toLowerCase();
  word = step1a(word);
  word = step1b(word);
  word = step1c(word);
  word = step2(word);
  word = step3(word);
  word = step4(word);
  word = step5a(word);
  word = step5b(word);
  return word;
}

/** No-op stemmer: lowercases only (matches stemlite's `_none_stemmer`). */
function noneStemmer(word: string): string {
  return word ? word.toLowerCase() : "";
}

/** Registry of built-in stemmers, keyed by name (mirrors `stemlite.STEMMERS`). */
export const STEMMERS: Record<string, StemmerFn> = {
  porter: porterStemmer,
  none: noneStemmer,
};

/**
 * Resolve a built-in stemmer by name, mirroring `stemlite.get_stemmer`.
 *
 * `null`/`undefined` or an unknown name yields the no-op (lowercase-only)
 * stemmer. Currently only `'porter'` is implemented in TypeScript; `'snowball'`
 * and `'lancaster'` fall back to the no-op stemmer (unlike Python, where they
 * are distinct algorithms) — so avoid persisting those names in an index that
 * a Node client will query.
 */
export function getStemmer(name?: string | null): StemmerFn {
  if (name == null) return STEMMERS.none;
  return STEMMERS[name.toLowerCase()] ?? STEMMERS.none;
}
