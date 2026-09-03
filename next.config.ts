import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets `next dev` serve assets when browsed via 127.0.0.1 (e.g. local overlay checks).
  allowedDevOrigins: ["127.0.0.1"],
  /* config options here */
};

export default nextConfig;
