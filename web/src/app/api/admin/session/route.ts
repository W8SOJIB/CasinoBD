import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/auth/adminSession";

export async function GET(req: NextRequest) {
  try {
    const session = requireAdminSession(req);
    return NextResponse.json({ ok: true, username: session.username });
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any).status
        : 401;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unauthorized" },
      { status }
    );
  }
}

