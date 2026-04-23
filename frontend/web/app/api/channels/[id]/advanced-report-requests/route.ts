import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  void request;

  return NextResponse.json(
    {
      error:
        "Advanced report requests are retired from the active product surface.",
    },
    { status: 410 },
  );
}
