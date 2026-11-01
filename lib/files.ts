export function sanitizeFileName(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf(".");
  const baseName =
    lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex);
  const rawExtension = lastDotIndex === -1 ? "" : fileName.slice(lastDotIndex);
  const extension = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExtension) ? rawExtension : "";

  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

  return `${safeBaseName || "file"}${extension.toLowerCase()}`;
}
