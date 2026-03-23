import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getFirestore } from "@/lib/firebase/admin";
import { requireFirebaseAuth } from "@/lib/auth/requireFirebaseAuth";
import { serverTimestamp } from "@/lib/firebase/admin";

const createRequestSchema = z.object({
  type: z.enum(["deposit", "withdraw"]),
  amountCents: z.number().int().positive(),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().min(6).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { uid } = await requireFirebaseAuth(req);
    const firestore = getFirestore();
    const q = await firestore
      .collection("depositWithdrawRequests")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const requests = q.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
    return NextResponse.json({ uid, requests });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { uid } = await requireFirebaseAuth(req);
    const firestore = getFirestore();
    const body = await req.json().catch(() => null);
    const parsed = createRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { type, amountCents, note } = parsed.data;

    const ref = firestore.collection("depositWithdrawRequests").doc();
    await ref.set({
      uid,
      type,
      amountCents,
      note: note ?? null,
      status: "pending",
      createdAt: serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      requestId: ref.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

