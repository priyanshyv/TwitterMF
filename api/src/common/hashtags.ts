// "#Postgres rocks #redis" -> ["postgres", "redis"]. Letters in any script,
// digits and underscores; lowercased so #Redis and #redis are one tag.
// \p{M} (combining marks) matters: in Hindi, "भारत" is भ + ा + र + त, and
// the vowel sign ा is a mark, not a letter. Without it, #भारत became #भ.
export const HASHTAG_CHARS = '\\p{L}\\p{M}\\p{N}_';
const HASHTAG = new RegExp(
  `(?:^|[^${HASHTAG_CHARS}&])#([${HASHTAG_CHARS}]{1,50})`,
  'gu',
);

export function extractHashtags(text: string): string[] {
  return [
    ...new Set([...text.matchAll(HASHTAG)].map((m) => m[1].toLowerCase())),
  ];
}
