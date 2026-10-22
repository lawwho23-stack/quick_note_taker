import type { NextConfig } from "next";

const apiBaseUrl = process.env.QUICK_NOTE_API_URL?.replace(/\/+$/, "");

if (!apiBaseUrl) {
  console.warn(
    "[quick-note] QUICK_NOTE_API_URL is not set. /api/v1/* requests will not be forwarded to the API.",
  );
}

const nextConfig: NextConfig = {
  transpilePackages: ["@quick-note/shared"],
  // Security headers on every page: no framing (clickjacking), no MIME
  // sniffing, and no full URLs leaked to other sites in the Referer header.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async rewrites() {
    if (!apiBaseUrl) {
      return [];
    }
    return {
      beforeFiles: [
        {
          source: "/api/v1/:path*",
          destination: `${apiBaseUrl}/v1/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
