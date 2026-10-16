import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The dev-only "N" button defaults to bottom-left, on top of the sidebar's
  // account chip.
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
