import type { NextConfig } from "next";
import { MAX_UPLOAD_REQUEST_SIZE } from "./lib/upload-limits";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: MAX_UPLOAD_REQUEST_SIZE,
  },
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/*.otf", "./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
