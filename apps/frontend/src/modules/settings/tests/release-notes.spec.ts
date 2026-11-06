import { describe, expect, it } from 'bun:test';

import {
  parseInline,
  parseReleaseNotes,
  shortenUrl,
} from '../utils/release-notes';

describe('parseReleaseNotes', () => {
  it('reads the notes the release workflow publishes', () => {
    const blocks = parseReleaseNotes(
      [
        '## Images',
        '',
        '```',
        'ghcr.io/acceleratio-cloud/api:0.1.6',
        'ghcr.io/acceleratio-cloud/console:0.1.6',
        '```',
        '',
        'Install or update with the scripts attached below (checksums in `SHA256SUMS`).',
        '',
        "## What's Changed",
        '* Add console updates by @someone in https://github.com/acceleratio-cloud/core/pull/42',
        '* Fix CI',
        '',
        '**Full Changelog**: https://github.com/acceleratio-cloud/core/compare/v0.1.5...v0.1.6',
      ].join('\r\n'),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'code',
      'paragraph',
      'heading',
      'list',
      'paragraph',
    ]);
    expect(blocks[1]).toEqual({
      type: 'code',
      text: 'ghcr.io/acceleratio-cloud/api:0.1.6\nghcr.io/acceleratio-cloud/console:0.1.6',
    });
    expect(blocks[4]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[5]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'strong', text: 'Full Changelog' },
        { type: 'text', text: ': ' },
        {
          type: 'link',
          text: 'v0.1.5...v0.1.6',
          href: 'https://github.com/acceleratio-cloud/core/compare/v0.1.5...v0.1.6',
        },
      ],
    });
  });

  it('joins wrapped lines and splits ordered from bullet lists', () => {
    const blocks = parseReleaseNotes(
      'First line\nsecond line\n\n1. one\n2. two\n- three\n  continued',
    );

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'First line second line' }],
      },
      {
        type: 'list',
        ordered: true,
        items: [
          [{ type: 'text', text: 'one' }],
          [{ type: 'text', text: 'two' }],
        ],
      },
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: 'three continued' }]],
      },
    ]);
  });

  it('returns nothing for empty notes', () => {
    expect(parseReleaseNotes('  \n\n')).toEqual([]);
  });
});

describe('parseInline', () => {
  it('keeps unsafe link targets as text', () => {
    expect(parseInline('[click](javascript:void) now')).toEqual([
      { type: 'text', text: 'click now' },
    ]);
  });

  it('reads links, code and bold', () => {
    expect(
      parseInline('See [docs](https://example.com), `x` and __y__.'),
    ).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', text: 'docs', href: 'https://example.com' },
      { type: 'text', text: ', ' },
      { type: 'code', text: 'x' },
      { type: 'text', text: ' and ' },
      { type: 'strong', text: 'y' },
      { type: 'text', text: '.' },
    ]);
  });
});

describe('shortenUrl', () => {
  it('shortens GitHub compare and pull request URLs', () => {
    expect(shortenUrl('https://github.com/o/r/pull/42')).toBe('#42');
    expect(shortenUrl('https://example.com/a')).toBe('https://example.com/a');
  });
});
