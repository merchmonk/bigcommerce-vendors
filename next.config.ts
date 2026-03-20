import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    adapterPath: import.meta.resolve('cdk-nextjs/adapter'),
  },
  serverExternalPackages: ['prisma', '@prisma/client'],
  outputFileTracingIncludes: {
    '/api/migrate': [
      './prisma/**/*',
      './node_modules/prisma/**/*',
      './node_modules/.prisma/**/*',
      './node_modules/@prisma/**/*',
    ],
  },
};

export default nextConfig;
