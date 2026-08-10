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
  // Baseline response headers for every route (see docs/SECURITY.md). No
  // Content-Security-Policy yet — Radix UI relies on inline `style`
  // attributes for positioning, so a CSP tight enough to matter would need
  // real testing (nonces or a style-src allowance) rather than a pass
  // that must not break local dev; tracked there as follow-up work.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers should never guess a response's MIME type — e.g. a
          // Dropbox-stored discovery file (see lib/storage) sniffed as
          // HTML.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // This app is never meant to be framed by another site.
          { key: "X-Frame-Options", value: "DENY" },
          // Don't leak full case/matter URLs via the Referer header to
          // anything this app might ever link out to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Browsers only honor this over an actual HTTPS response, so it's
          // a no-op (not a footgun) in local HTTP development.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
