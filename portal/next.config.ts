import type { NextConfig } from "next";

// The portal is a static single-page app: it talks to Supabase straight from the browser, and every
// privileged action is a database function that checks who is calling (supabase/migrations).
// So it can be hosted on any static host.
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
