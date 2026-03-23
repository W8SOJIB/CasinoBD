import type { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

type AdminSessionPayload = {
  username: string;
  // iat/exp are included by JWT
};

const SESSION_COOKIE_NAME = "admin_session";

function getCookieValue(req: NextRequest, name: string): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  // Simple cookie parsing: `key=value; key2=value2`
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === name) return value || null;
  }
  return null;
}

export function requireAdminSession(req: NextRequest): AdminSessionPayload {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    // Server misconfiguration
    throw Object.assign(new Error("ADMIN_SESSION_SECRET missing"), {
      status: 500,
    });
  }

  const token = getCookieValue(req, SESSION_COOKIE_NAME);
  if (!token) {
    throw Object.assign(new Error("Missing admin session"), { status: 401 });
  }

  try {
    const decoded = jwt.verify(token, secret) as AdminSessionPayload;
    if (!decoded || typeof decoded.username !== "string") {
      throw new Error("Invalid session payload");
    }
    return decoded;
  } catch {
    throw Object.assign(new Error("Invalid admin session"), { status: 401 });
  }
}

export function createAdminSessionToken(params: {
  username: string;
  expiresInSeconds?: number;
}): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET missing");
  }

  const { username, expiresInSeconds = 60 * 60 * 24 * 7 } = params;

  return jwt.sign({ username } satisfies AdminSessionPayload, secret, {
    expiresIn: expiresInSeconds,
  });
}

export { SESSION_COOKIE_NAME };

