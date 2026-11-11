/**
 * A picked folder arrives as `dist/index.html`, `dist/app.js`: its own name
 * is dropped, so the folder's contents become the site root.
 */
export const sitePath = (file: Pick<File, 'name' | 'webkitRelativePath'>) =>
  file.webkitRelativePath
    ? file.webkitRelativePath.split('/').slice(1).join('/')
    : file.name;

/**
 * Whether the site keeps a file: hidden files and folders (`.git/`, `.env`)
 * are not sent, except `.well-known/` at the root. Mirrors `isServedPath` in
 * the API, which drops them anyway; skipping them here saves the upload.
 */
export const isServedPath = (path: string) =>
  !path
    .split('/')
    .some(
      (segment, index) =>
        segment.startsWith('.') && !(index === 0 && segment === '.well-known'),
    );

/**
 * Sends every item with at most `parallel` in flight. The first failure
 * aborts `signal` and stops the queue, so no further item starts and the ones
 * in flight are cancelled; the promise rejects with that first error.
 */
export const sendAll = async <T>(
  items: T[],
  send: (item: T, signal: AbortSignal) => Promise<void>,
  parallel: number,
  abort: AbortController = new AbortController(),
): Promise<void> => {
  const queue = [...items];

  await Promise.all(
    Array.from({ length: parallel }, async () => {
      for (
        let item = queue.shift();
        item !== undefined && !abort.signal.aborted;
        item = queue.shift()
      ) {
        try {
          await send(item, abort.signal);
        } catch (error) {
          abort.abort();
          throw error;
        }
      }
    }),
  );
};
