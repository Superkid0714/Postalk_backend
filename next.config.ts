import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/*.otf", "./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
