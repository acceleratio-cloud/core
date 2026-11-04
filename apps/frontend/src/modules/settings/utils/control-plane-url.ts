/**
 * Loose client-side form of the API's normalization, used only to tell
 * whether the input still matches the saved pending URL. The API validates.
 */
export const toComparableUrl = (value: string): string => {
  const host = value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();

  return host ? `https://${host}` : '';
};

/** The bare domain of a stored URL, as shown in the input (no scheme or slash). */
export const toDomain = (value: string | null | undefined): string =>
  (value ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/+$/, '');
