import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // Static export has no image server; screenshots ship as they are.
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default withMDX(config);
