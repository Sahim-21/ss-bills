import type { NextConfig } from "next";

// SS Bills runs offline inside Electron, so the UI is a static export (no Next.js
// server at runtime). Electron serves the `out/` folder via a custom app:// protocol.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
