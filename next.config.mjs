const isDev = process.env.NODE_ENV === "development";

// Minimal CSP for the current app: no per-request nonce (that would
// require generating one in proxy.ts and forcing dynamic rendering on
// every page — see node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md), so this follows Next.js's documented
// "without nonces" baseline instead. `unsafe-inline` on style-src is
// required for Radix UI's inline positioning styles; `unsafe-inline` on
// script-src is required for Next.js's own inline hydration scripts,
// which aren't nonced without the proxy-based setup above. `unsafe-eval`
// is dev-only, needed for React's dev-mode error-stack reconstruction —
// neither React nor Next.js use `eval` in production. `img-src` allows
// `data:` for the MFA-enrollment QR code, which is rendered as a
// server-generated data URL (see components/shared/mfa-enrollment-form.tsx).
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't disclose the framework in every response.
  poweredByHeader: false,
  experimental: {
    // Default (1mb) is too small for fictional/test discovery files
    // (PDFs, short audio/video clips) uploaded via Server Actions.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  // Baseline response headers for every route (see docs/SECURITY.md).
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
          { key: "Content-Security-Policy", value: cspHeader.replace(/\s{2,}/g, " ").trim() },
        ],
      },
    ];
  },
};

export default nextConfig;
