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
