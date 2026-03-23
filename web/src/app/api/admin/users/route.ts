import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuth, getFirestore } from "@/lib/firebase/admin";
import { requireAdminSession } from "@/lib/auth/adminSession";

const querySchema = z
  .object({
    limit: z.string().optional(),
  })
  .passthrough();

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);

    const firestore = getFirestore();
    const auth = getAuth();

    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    const limitNum = parsed.success && parsed.data.limit ? Number(parsed.data.limit) : 100;
    const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(200, limitNum)) : 100;

    const list = await auth.listUsers(limit);

    const users = await Promise.all(
      list.users.map(async (u) => {
        const doc = await firestore.collection("users").doc(u.uid).get();
        const docData = doc.exists
          ? (doc.data() as {
              banned?: boolean;
              balanceCents?: number;
              updatedAt?: unknown;
            })
          : null;

        return {
          uid: u.uid,
          email: u.email ?? null,
          displayName: u.displayName ?? null,
          disabled: Boolean(u.disabled),
          banned: docData?.banned === true,
          balanceCents:
            typeof docData?.balanceCents === "number"
              ? (docData.balanceCents as number)
              : 0,
          updatedAt: docData?.updatedAt ?? null,
        };
      })
    );

    return NextResponse.json({ users });
  } catch (err) {
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : 401;

    return NextResponse.json({ error: "Unauthorized" }, { status });
  }
}

