import { describe, expect, it } from 'bun:test';

import type { EnvVar } from '@acceleratio/shared';
import {
  formatDotenv,
  parseDotenv,
  sameEnv,
  scanDotenv,
} from '@/modules/workloads/utils/dotenv';

const vars = (text: string) => parseDotenv(text).vars;
const errors = (text: string) => parseDotenv(text).errors;

describe('parseDotenv', () => {
  it('reads plain KEY=value lines in order', () => {
    expect(vars('B=2\nA=1')).toEqual([
      { key: 'B', value: '2' },
      { key: 'A', value: '1' },
    ]);
  });

  it('skips blank lines and comment lines', () => {
    expect(vars('\n# comment\n   \n  # indented\nA=1\n\n')).toEqual([
      { key: 'A', value: '1' },
    ]);
  });

  it('accepts an export prefix and spaces around the name', () => {
    expect(vars('export A=1\n  B =2\nexport\tC=3')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
      { key: 'C', value: '3' },
    ]);
  });

  it('trims unquoted values and ends them at a spaced #', () => {
    expect(vars('A=  hello world  # note\nB=x#y\nC=#fff')).toEqual([
      { key: 'A', value: 'hello world' },
      { key: 'B', value: 'x#y' },
      { key: 'C', value: '#fff' },
    ]);
  });

  it('keeps everything after the first =', () => {
    expect(vars('URL=postgres://u:p@h/db?a=1&b=2')).toEqual([
      { key: 'URL', value: 'postgres://u:p@h/db?a=1&b=2' },
    ]);
  });

  it('reads an empty value', () => {
    expect(vars('A=\nB=""\nC=\'\'')).toEqual([
      { key: 'A', value: '' },
      { key: 'B', value: '' },
      { key: 'C', value: '' },
    ]);
  });

  it('keeps single-quoted text literally', () => {
    expect(vars("A='a \\n $B # not a comment'")).toEqual([
      { key: 'A', value: 'a \\n $B # not a comment' },
    ]);
  });

  it('unescapes double-quoted values', () => {
    expect(vars('A="line\\nnext \\"q\\" \\\\ tab\\t \\x"')).toEqual([
      { key: 'A', value: 'line\nnext "q" \\ tab\t \\x' },
    ]);
  });

  it('lets quoted values span lines', () => {
    expect(vars('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1')).toEqual([
      { key: 'KEY', value: '-----BEGIN-----\nabc\n-----END-----' },
      { key: 'NEXT', value: '1' },
    ]);
  });

  it('allows a comment after a quoted value', () => {
    expect(parseDotenv('A="x y"   # note')).toEqual({
      vars: [{ key: 'A', value: 'x y' }],
      errors: [],
    });
  });

  it('does not expand variables', () => {
    expect(vars('A=$HOME\nB="${A}"')).toEqual([
      { key: 'A', value: '$HOME' },
      { key: 'B', value: '${A}' },
    ]);
  });

  it('reads CRLF files', () => {
    expect(parseDotenv('A=1\r\nB="2"\r\nC=\'3\'  # c\r\n# d\r\n')).toEqual({
      vars: [
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
        { key: 'C', value: '3' },
      ],
      errors: [],
    });
  });

  it.each(['1A', 'WITH-DASH', 'dot.ted', 'sp ace'])(
    'rejects the name %p with its line number',
    (key) => {
      expect(errors(`OK=1\n${key}=x`)).toEqual([
        { line: 2, message: expect.stringContaining(key) },
      ]);
      expect(vars(`OK=1\n${key}=x`)).toEqual([{ key: 'OK', value: '1' }]);
    },
  );

  it('rejects a line without =', () => {
    expect(errors('A=1\nJUST_A_NAME')).toEqual([
      { line: 2, message: 'Expected KEY=value.' },
    ]);
  });

  it('rejects a missing name', () => {
    expect(errors('=value')).toEqual([
      { line: 1, message: 'Missing variable name.' },
    ]);
  });

  it('reports a duplicate name with the line it was first set on', () => {
    expect(parseDotenv('A=1\nB=2\nA=3')).toEqual({
      vars: [
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
      ],
      errors: [{ line: 3, message: 'A is already set on line 1.' }],
    });
  });

  it('reports an unterminated quote on the line it opens', () => {
    expect(parseDotenv('A=1\nB="open\nC=2')).toEqual({
      vars: [{ key: 'A', value: '1' }],
      errors: [{ line: 2, message: 'Missing closing double quote.' }],
    });
    expect(errors("A='open")).toEqual([
      { line: 1, message: 'Missing closing single quote.' },
    ]);
  });

  it('counts lines inside multi-line values', () => {
    expect(errors('A="x\ny\nz"\nBAD')).toEqual([
      { line: 4, message: 'Expected KEY=value.' },
    ]);
  });

  it('rejects text after a closing quote', () => {
    expect(errors('A="x" y')).toEqual([
      { line: 1, message: 'Unexpected text after the value.' },
    ]);
  });
});

describe('formatDotenv', () => {
  it('leaves simple values bare and quotes the rest', () => {
    expect(
      formatDotenv([
        { key: 'A', value: 'plain' },
        { key: 'B', value: '' },
        { key: 'C', value: 'two words' },
        { key: 'D', value: '#fff' },
        { key: 'E', value: 'say "hi"\n\tback\\slash' },
      ]),
    ).toBe(
      [
        'A=plain',
        'B=',
        'C="two words"',
        'D="#fff"',
        'E="say \\"hi\\"\\n\\tback\\\\slash"',
      ].join('\n'),
    );
  });

  it('formats nothing as an empty file', () => {
    expect(formatDotenv([])).toBe('');
  });

  it.each<[string, EnvVar[]]>([
    ['plain values', [{ key: 'A', value: '1' }]],
    [
      'tricky values',
      [
        { key: 'QUOTES', value: `it's "quoted"` },
        { key: 'HASH', value: 'a #b' },
        { key: 'LEADING', value: '  spaced  ' },
        { key: 'MULTI', value: 'a\nb\r\nc' },
        { key: 'BACKSLASH', value: 'C:\\path\\n' },
        { key: 'UNICODE', value: 'привет 🌍' },
        { key: 'EMPTY', value: '' },
        { key: 'DOLLAR', value: '$X ${Y}' },
      ],
    ],
  ])('reads back %s unchanged', (_, input) => {
    expect(parseDotenv(formatDotenv(input))).toEqual({
      vars: input,
      errors: [],
    });
  });
});

describe('scanDotenv tokens', () => {
  const sample = [
    '# header',
    'export A=1',
    'B = "two\nlines"  # note',
    "C='x'",
    'D=#fff',
    '1BAD=x',
    'oops',
    '',
  ].join('\n');

  it('reproduces the input exactly', () => {
    expect(
      scanDotenv(sample)
        .tokens.map((token) => token.text)
        .join(''),
    ).toBe(sample);
  });

  it('classifies each part', () => {
    const typed = scanDotenv(sample).tokens.filter(
      (token) => token.type !== 'plain',
    );

    expect(typed).toEqual([
      { type: 'comment', text: '# header' },
      { type: 'export', text: 'export' },
      { type: 'key', text: 'A' },
      { type: 'operator', text: '=' },
      { type: 'value', text: '1' },
      { type: 'key', text: 'B ' },
      { type: 'operator', text: '=' },
      { type: 'string', text: '"two\nlines"' },
      { type: 'comment', text: '# note' },
      { type: 'key', text: 'C' },
      { type: 'operator', text: '=' },
      { type: 'string', text: "'x'" },
      { type: 'key', text: 'D' },
      { type: 'operator', text: '=' },
      { type: 'value', text: '#fff' },
      { type: 'invalid', text: '1BAD' },
      { type: 'operator', text: '=' },
      { type: 'value', text: 'x' },
      { type: 'invalid', text: 'oops' },
    ]);
  });

  it('marks an unterminated quote to the end of the file', () => {
    const { tokens } = scanDotenv('A="open\nB=1');

    expect(tokens.at(-1)).toEqual({ type: 'invalid', text: '"open\nB=1' });
  });
});

describe('sameEnv', () => {
  it('compares names, values and order', () => {
    const base = [
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ];

    expect(sameEnv(base, [...base])).toBe(true);
    expect(sameEnv(base, [base[1], base[0]])).toBe(false);
    expect(sameEnv(base, [base[0], { key: 'B', value: '3' }])).toBe(false);
    expect(sameEnv(base, [base[0]])).toBe(false);
  });
});
