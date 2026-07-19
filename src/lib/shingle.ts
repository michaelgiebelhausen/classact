/**
 * Near-duplicate detection via word shingling + Jaccard similarity
 * (pure, no I/O, no API). Everyone answered the same prompt, so unusually
 * similar pairs — collusion, or the same one-shot from the same model —
 * stand out. Findings surface privately to the professor; never penalized
 * automatically, never framed as an accusation.
 */

const SHINGLE_SIZE = 5;
/** Jaccard similarity above this is worth a human look. */
export const SIMILARITY_THRESHOLD = 0.35;

/** Lowercase, strip punctuation and digits, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hashed word 5-grams. */
export function shingles(text: string): Set<number> {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const set = new Set<number>();
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++) {
    const gram = words.slice(i, i + SHINGLE_SIZE).join(" ");
    let h = 2166136261;
    for (let j = 0; j < gram.length; j++) {
      h ^= gram.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    set.add(h >>> 0);
  }
  return set;
}

export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const h of small) if (large.has(h)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export interface SimilarPair {
  aId: string;
  bId: string;
  similarity: number;
}

/** All pairs above the threshold, most similar first. */
export function findSimilarPairs(
  docs: Array<{ id: string; text: string }>,
  threshold = SIMILARITY_THRESHOLD
): SimilarPair[] {
  const sets = docs.map((d) => ({ id: d.id, set: shingles(d.text) }));
  const hits: SimilarPair[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const similarity = jaccard(sets[i].set, sets[j].set);
      if (similarity >= threshold) {
        hits.push({
          aId: sets[i].id,
          bId: sets[j].id,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
    }
  }
  return hits.sort((a, b) => b.similarity - a.similarity);
}
