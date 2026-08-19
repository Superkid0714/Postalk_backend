import { getInstagramEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

type InstagramShortLivedTokenResponse = {
  access_token: string;
  user_id?: string | number;
  permissions?: string;
};

type InstagramLongLivedTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type InstagramMeResponse = {
  user_id?: string | number;
  id?: string | number;
  username?: string;
};

function getOAuthConfig() {
  const env = getInstagramEnv();

  if (!env.appId || !env.appSecret) {
    throw new Error("Instagram OAuth is not configured");
  }

  return {
    ...env,
    appId: env.appId,
    appSecret: env.appSecret,
  };
}

async function readErrorText(response: Response) {
  const text = await response.text();

  try {
    const json = JSON.parse(text) as {
      error?: {
        message?: string;
        type?: string;
        code?: number;
      };
    };

    return json.error?.message ?? text;
  } catch {
    return text;
  }
}

export async function exchangeInstagramCodeForLongLivedToken(params: {
  code: string;
  redirectUri: string;
}) {
  const config = getOAuthConfig();

  const shortLivedResponse = await fetchWithTimeout("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: params.redirectUri,
      code: params.code,
    }),
    timeoutMs: 30_000,
  });

  if (!shortLivedResponse.ok) {
    throw new Error(await readErrorText(shortLivedResponse));
  }

  const shortLivedPayload =
    (await shortLivedResponse.json()) as InstagramShortLivedTokenResponse;

  const longLivedUrl = new URL("https://graph.instagram.com/access_token");
  longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
  longLivedUrl.searchParams.set("client_secret", config.appSecret);
  longLivedUrl.searchParams.set("access_token", shortLivedPayload.access_token);

  const longLivedResponse = await fetchWithTimeout(longLivedUrl, {
    timeoutMs: 30_000,
  });

  if (!longLivedResponse.ok) {
    throw new Error(await readErrorText(longLivedResponse));
  }

  const longLivedPayload =
    (await longLivedResponse.json()) as InstagramLongLivedTokenResponse;

  const meUrl = new URL("https://graph.instagram.com/me");
  meUrl.searchParams.set("fields", "user_id,username");
  meUrl.searchParams.set("access_token", longLivedPayload.access_token);

  const meResponse = await fetchWithTimeout(meUrl, {
    timeoutMs: 30_000,
  });

  if (!meResponse.ok) {
    throw new Error(await readErrorText(meResponse));
  }

  const mePayload = (await meResponse.json()) as InstagramMeResponse;

  return {
    accessToken: longLivedPayload.access_token,
    userId: String(
      mePayload.user_id ?? mePayload.id ?? shortLivedPayload.user_id ?? "",
    ),
    username: mePayload.username ?? null,
    expiresIn: longLivedPayload.expires_in ?? null,
    tokenType: longLivedPayload.token_type ?? null,
  };
}
