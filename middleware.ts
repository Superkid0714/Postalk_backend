import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "https://posttalk.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-admin-api-key, x-admin-key",
  "Access-Control-Max-Age": "86400",
};

function applyCorsHeaders(response: NextResponse, origin: string | null) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  return applyCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: ["/api/:path*"],
};
