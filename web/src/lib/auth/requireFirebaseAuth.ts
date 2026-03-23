import type { NextRequest } from "next/server";
import { verifyFirebaseIdToken } from "../firebase/admin";

export type AuthedUser = {
  uid: string;
  claims: Record<string, unknown>;
};

export async function requireFirebaseAuth(req: NextRequest): Promise<AuthedUser> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/i);
  const idToken = match?.[1];
  if (!idToken) {
    throw new Error("Missing Bearer token.");
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  return {
    uid: decoded.uid,
    claims: decoded as Record<string, unknown>,
  };
}

export function isAdminFromClaims(claims: Record<string, unknown>) {
  // Custom Claims are usually boolean strings like { role: "admin" } or { admin: true }.
  const role = claims.role;
  if (role === "admin") return true;
  if (claims.admin === true) return true;
  return false;
}

