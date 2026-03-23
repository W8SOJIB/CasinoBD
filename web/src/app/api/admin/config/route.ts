import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getFirestore, serverTimestamp } from "@/lib/firebase/admin";
import { requireAdminSession } from "@/lib/auth/adminSession";

const updateSchema = z.object({
  luckPercent: z.number().min(0).max(100),
  scatterPercent: z.number().min(0).max(100),
});

const DEFAULT_CONFIG = {
  luckPercent: 50,
  scatterPercent: 2.2,
};

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);
    const firestore = getFirestore();
    const doc = await firestore.collection("gameConfig").doc("superAce").get();
    const data = doc.exists ? doc.data() ?? {} : {};

    return NextResponse.json({
      luckPercent:
        typeof data.luckPercent === "number"
          ? data.luckPercent
          : DEFAULT_CONFIG.luckPercent,
      scatterPercent:
        typeof data.scatterPercent === "number"
          ? data.scatterPercent
          : DEFAULT_CONFIG.scatterPercent,
    });
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

export async function POST(req: NextRequest) {
  try {
    const session = requireAdminSession(req);
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const firestore = getFirestore();
    await firestore.collection("gameConfig").doc("superAce").set(
      {
        luckPercent: parsed.data.luckPercent,
        scatterPercent: parsed.data.scatterPercent,
        updatedAt: serverTimestamp(),
        updatedBy: session.username,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

