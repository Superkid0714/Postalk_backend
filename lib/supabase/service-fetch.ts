// Secret API keys are opaque credentials, not user JWTs. The SDK can supply
// a Bearer fallback for REST requests; authenticate these through apikey only.
export function createServiceFetch(serviceKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (serviceKey.startsWith("sb_secret_") && headers.get("authorization") === `Bearer ${serviceKey}`) {
      headers.delete("authorization");
    }
    return globalThis.fetch(input, { ...init, headers });
  };
}
