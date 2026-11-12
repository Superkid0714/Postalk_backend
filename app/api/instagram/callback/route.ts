import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function page(title: string, message: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p><p>이 창을 닫고 Postalk 설정 화면으로 돌아가세요.</p></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

/**
 * OAuth redirect landing page for Instagram Business Login.
 *
 * The authorization code remains in the browser URL for the server-side
 * token exchange step; it is intentionally never rendered or logged here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.has("error")) {
    return page("Instagram 연결이 취소되었습니다", "권한 승인 또는 로그인 과정이 완료되지 않았습니다.", 400);
  }

  if (!url.searchParams.has("code")) {
    return page("Instagram 연결을 확인할 수 없습니다", "인증 코드가 전달되지 않았습니다.", 400);
  }

  return page("Instagram 연결이 완료되었습니다", "인증이 성공했습니다. 토큰 교환을 계속할 수 있습니다.");
}
