import { NextResponse } from "next/server";

export function successResponse<T>(
  data: T,
  message = "OK",
  status = 200,
) {
  return NextResponse.json(
    {
      success: true,
      message,
      data,
    },
    { status },
  );
}

export function errorResponse(
  message: string,
  status: number,
  error?: {
    code: string;
    details?: unknown;
  },
) {
  return NextResponse.json(
    {
      success: false,
      message,
      ...(error ? { error } : {}),
    },
    { status },
  );
}
