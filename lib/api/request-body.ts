const STRING_FIELDS = new Set([
  "qrToken", "storeId", "marketName", "storeName", "ownerName", "category",
  "locationAddress", "adType", "menuIntro", "storeSpecialty", "introText",
  "submissionId", "stylePreset", "bucket", "filePath", "fileName", "mimeType",
  "submitterName", "submitterAffiliation", "qrPayload", "storeType",
  "targetMenuName", "priceText", "appealPoint", "targetCustomer", "peakSalesTime",
  "popularMenuNotes", "extraMessage", "title", "caption", "transcript",
  "assetType", "aspectRatio", "resolution", "mediaType", "captionOverride",
]);
const NUMBER_FIELDS = new Set(["fileSize", "sortOrder", "shotOrder", "durationSeconds", "durationMs"]);
const NULLABLE_FIELDS = new Set(["mimeType", "fileSize", "sortOrder", "caption", "durationSeconds", "durationMs"]);

export function validateRequestBody(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  for (const [key, field] of Object.entries(value)) {
    if (field === null && NULLABLE_FIELDS.has(key)) continue;
    if (STRING_FIELDS.has(key) && (typeof field !== "string" || field.length > 20_000)) {
      throw new Error(`${key} must be a string of at most 20000 characters`);
    }
    if (NUMBER_FIELDS.has(key) && (typeof field !== "number" || !Number.isFinite(field) || field < 0)) {
      throw new Error(`${key} must be a finite non-negative number`);
    }
    if (key === "mockMode" && typeof field !== "boolean") throw new Error("Invalid mockMode");
    if (key === "hashtags" && (!Array.isArray(field) || field.length > 100 || field.some(item => typeof item !== "string" || item.length > 200))) {
      throw new Error("Invalid hashtags");
    }
    if (key === "aiMetadata" && (!field || typeof field !== "object" || Array.isArray(field))) {
      throw new Error("Invalid aiMetadata");
    }
    if (key === "aiMetadata" && field && typeof field === "object" &&
      ["adWorkflow", "videoWorkflow", "instagramPublish", "instagramMetrics"].some(name => name in field)) {
      throw new Error("Server-managed workflow metadata cannot be supplied by clients");
    }
    if (key === "assets") {
      if (!Array.isArray(field) || field.length > 30) throw new Error("Invalid assets");
      for (const asset of field) {
        validateRequestBody(asset);
        if (!["menu_board", "food_photo"].includes(asset.assetType as string)) {
          throw new Error("Only original menu_board and food_photo assets may be submitted");
        }
        if (typeof asset.filePath !== "string" || !asset.filePath.trim()) throw new Error("Missing asset filePath");
      }
    }
  }
}

export async function readRequestBody(request: Request) {
  const value: unknown = await request.json();
  validateRequestBody(value);
  return value;
}
