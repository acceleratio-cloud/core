export type TextSegment = { text: string; match: boolean };

/**
 * Splits `text` around case-insensitive occurrences of `phrase`, the same
 * match the API's `i("…")` filter makes, so the highlighted part is exactly
 * what made the line match.
 */
export const splitMatches = (text: string, phrase: string): TextSegment[] => {
  const needle = phrase.trim().toLowerCase();

  if (!needle) {
    return [{ text, match: false }];
  }

  const haystack = text.toLowerCase();
  const segments: TextSegment[] = [];
  let index = 0;

  while (index < text.length) {
    const found = haystack.indexOf(needle, index);

    if (found === -1) {
      break;
    }

    if (found > index) {
      segments.push({ text: text.slice(index, found), match: false });
    }

    segments.push({
      text: text.slice(found, found + needle.length),
      match: true,
    });
    index = found + needle.length;
  }

  if (index < text.length) {
    segments.push({ text: text.slice(index), match: false });
  }

  return segments.length > 0 ? segments : [{ text, match: false }];
};
