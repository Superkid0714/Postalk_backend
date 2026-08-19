import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { exchangeInstagramCodeForLongLivedToken } from "@/lib/instagram/oauth";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription =
    url.searchParams.get("error_description") ??
    url.searchParams.get("error_message");

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Instagram login was not completed",
        error,
        errorDescription,
      },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing Instagram authorization code",
      },
      { status: 400 },
    );
  }

  const redirectUri = `${url.origin}${url.pathname}`;

  try {
    const result = await exchangeInstagramCodeForLongLivedToken({
      code,
      redirectUri,
    });

    const html = `
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Instagram OAuth Success</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #f7f7fb;
        color: #151515;
        margin: 0;
        padding: 32px 20px;
      }
      .card {
        max-width: 760px;
        margin: 0 auto;
        background: #fff;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
      }
      h1 {
        margin: 0 0 16px;
        font-size: 28px;
      }
      p {
        line-height: 1.6;
      }
      code, pre {
        font-family: Consolas, monospace;
      }
      pre {
        background: #111827;
        color: #f9fafb;
        padding: 16px;
        border-radius: 12px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Instagram OAuth 성공</h1>
      <p>아래 값을 <code>.env</code>에 넣으면 됩니다.</p>
      <pre>INSTAGRAM_ACCESS_TOKEN=${escapeHtml(result.accessToken)}
INSTAGRAM_IG_USER_ID=${escapeHtml(result.userId)}
INSTAGRAM_GRAPH_API_VERSION=v25.0</pre>
      <p>username: <strong>${escapeHtml(result.username ?? "")}</strong></p>
      <p>expiresIn: <strong>${escapeHtml(String(result.expiresIn ?? ""))}</strong></p>
    </div>
  </body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (exchangeError) {
    const message =
      exchangeError instanceof Error
        ? exchangeError.message
        : "Instagram OAuth exchange failed";

    return NextResponse.json(
      {
        success: false,
        message: "Instagram OAuth exchange failed",
        details: message,
        redirectUri,
      },
      { status: 500 },
    );
  }
}
