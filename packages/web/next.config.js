/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Use standalone output for Docker/VPS deployments; skip on Vercel (Vercel handles its own optimisation)
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  experimental: {
    serverComponentsExternalPackages: ['mongoose', 'bcryptjs'],
  },
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
