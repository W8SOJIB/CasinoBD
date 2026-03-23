import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, requireAdminSession } from "@/lib/auth/adminSession";

export async function POST(req: NextRequest) {
  try {
    // If session is invalid we still clear the cookie for convenience.
    requireAdminSession(req);
  } catch {
    // ignore
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

