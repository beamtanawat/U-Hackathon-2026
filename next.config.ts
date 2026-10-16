import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The approved U-Topia reference UI is a single static page; serve it at /.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/u-topia-handshake.html" }], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};

export default nextConfig;
