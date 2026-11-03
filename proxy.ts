import { NextRequest, NextResponse } from "next/server";
import { parseCorsOrigins } from "@/lib/cors";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-merchant-qr-token, x-user-id, x-creation-token",
  "Access-Control-Max-Age": "86400",
};

function applyCorsHeaders(response: NextResponse, origin: string | null) {
  response.headers.append("Vary", "Origin");
  if (origin && parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS).has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  return applyCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: ["/api/:path*"],
};
