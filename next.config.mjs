/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        pathname: '/**',
      },
      {
        // Wikipedia's thumbnail service — most guest photoUrls actually
        // resolve here, not to upload.wikimedia.org. Missing this crashed
        // next/image (and the whole page render) for any of the 505 guests
        // (88% of all guest photos) whose photoUrl uses this host.
        protocol: 'https',
        hostname: 'thumb.wikimedia.org',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
