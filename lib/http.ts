export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit & {
    timeoutMs?: number;
  },
) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, init?.timeoutMs ?? 30_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
