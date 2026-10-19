import type { NextConfig } from "next";

const apiBaseUrl = process.env.QUICK_NOTE_API_URL?.replace(/\/+$/, "");

if (!apiBaseUrl) {
  console.warn(
    "[quick-note] QUICK_NOTE_API_URL is not set. /api/v1/* requests will not be forwarded to the API.",
  );
}

const nextConfig: NextConfig = {
  transpilePackages: ["@quick-note/shared"],
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
