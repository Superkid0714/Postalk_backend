import { errorResponse } from "@/lib/api/response";

export function generationConflictResponse(error: { code?: string } | null | undefined) {
  return error?.code === "23505"
    ? errorResponse("A generation job is already active for this submission", 409, { code: "GENERATION_ALREADY_ACTIVE" })
    : null;
}
