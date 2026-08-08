/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Default (1mb) is too small for fictional/test discovery files
    // (PDFs, short audio/video clips) uploaded via Server Actions.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
