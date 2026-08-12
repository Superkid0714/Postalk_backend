export function sanitizeFileName(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf(".");
  const baseName =
    lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex);
  const extension = lastDotIndex === -1 ? "" : fileName.slice(lastDotIndex);

  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

  return `${safeBaseName || "file"}${extension.toLowerCase()}`;
}
