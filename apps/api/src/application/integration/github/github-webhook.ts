import { createHmac, timingSafeEqual } from 'node:crypto';

/** Checks `X-Hub-Signature-256` against the raw request body. */
export const verifyWebhookSignature = (
  secret: string,
  rawBody: Buffer | undefined,
  header: string | undefined,
): boolean => {
  if (!rawBody || !header) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
