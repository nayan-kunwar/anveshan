/** API origin for /api rewrites (service name in Compose, localhost for dev). */
const API_URL = process.env["API_INTERNAL_URL"] ?? "http://localhost:3000";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
