/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { allowedOrigins: ['localhost:3000'] } },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }, { protocol: 'https', hostname: 'lh3.googleusercontent.com' }] },
}
module.exports = nextConfig
