import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    adapterPath: import.meta.resolve('cdk-nextjs/adapter'),
  },
};

export default nextConfig;
