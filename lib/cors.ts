const defaults = ['https://posttalk.vercel.app','http://localhost:5173','http://127.0.0.1:5173'];

export function parseCorsOrigins(raw?: string) {
  return new Set((raw?.trim() ? raw.split(',') : defaults).map(value => {
    const input = value.trim();
    const url = new URL(input);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('CORS_ALLOWED_ORIGINS must contain only comma-separated HTTP(S) origins');
    }
    return url.origin;
  }));
}
