import { describe, expect, it } from 'bun:test';

import { sendAll, sitePath } from '@/modules/workloads/utils/static-site';

describe('sitePath', () => {
  it('drops the picked folder name', () => {
    expect(
      sitePath({ name: 'app.js', webkitRelativePath: 'dist/assets/app.js' }),
    ).toBe('assets/app.js');
  });

  it('keeps a picked file at the root', () => {
    expect(sitePath({ name: 'index.html', webkitRelativePath: '' })).toBe(
      'index.html',
    );
  });
});

describe('sendAll', () => {
  it('sends every item with the given parallelism', async () => {
    let running = 0;
    let peak = 0;
    const sent: number[] = [];

    await sendAll(
      [1, 2, 3, 4, 5],
      async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        sent.push(item);
        running -= 1;
      },
      2,
    );

    expect(sent.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('stops the queue and aborts the rest after the first failure', async () => {
    const abort = new AbortController();
    const started: number[] = [];

    const result = sendAll(
      [1, 2, 3, 4, 5, 6],
      async (item, signal) => {
        started.push(item);

        if (item === 1) {
          throw new Error('502');
        }

        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(signal.aborted).toBe(true);
      },
      2,
      abort,
    );

    await expect(result).rejects.toThrow('502');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(abort.signal.aborted).toBe(true);
    // Only the two first items ever started.
    expect(started).toEqual([1, 2]);
  });
});
