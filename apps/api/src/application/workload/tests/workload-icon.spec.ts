import { BadRequestException } from '@nestjs/common';
import { normalizeWorkloadIcon } from '../workload-icon';

describe('normalizeWorkloadIcon', () => {
  it.each([
    [null, null],
    ['python', 'python'],
    [' rust ', 'rust'],
    ['https://cdn.example.com/logo.svg', 'https://cdn.example.com/logo.svg'],
  ])('accepts %p', (input, expected) => {
    expect(normalizeWorkloadIcon(input)).toBe(expected);
  });

  it.each([
    undefined,
    42,
    '',
    'not-a-pack-icon',
    'http://example.com/logo.svg',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    'file:///etc/passwd',
    `https://example.com/${'a'.repeat(2048)}.svg`,
    // Short input that grows past the cap once percent-encoded.
    `https://example.com/${'é'.repeat(1000)}`,
  ])('rejects %p', (input) => {
    expect(() => normalizeWorkloadIcon(input)).toThrow(BadRequestException);
  });
});
