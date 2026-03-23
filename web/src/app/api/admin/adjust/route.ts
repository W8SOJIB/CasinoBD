import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getFirestore, serverTimestamp } from "@/lib/firebase/admin";
import { requireFirebaseAuth, isAdminFromClaims } from "@/lib/auth/requireFirebaseAuth";

const adjustSchema = z.object({
  uid: z.string().min(6),
  amountCents: z.number().int(),
  reason: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { uid: adminUid, claims } = await requireFirebaseAuth(req);
    if (!isAdminFromClaims(claims)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const firestore = getFirestore();
    const body = await req.json().catch(() => null);
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { uid, amountCents, reason } = parsed.data;
    if (amountCents === 0) {
      return NextResponse.json({ error: "amountCents must not be 0" }, { status: 400 });
    }

    const userRef = firestore.collection("users").doc(uid);
    const ledgerRef = firestore.collection("ledgerEntries").doc();

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const beforeBalanceCents =
        snap.exists && typeof snap.data()?.balanceCents === "number"
          ? (snap.data()!.balanceCents as number)
          : 0;

      const afterBalanceCents = beforeBalanceCents + amountCents;

      tx.set(
        userRef,
        { balanceCents: afterBalanceCents, updatedAt: serverTimestamp() },
        { merge: true }
      );

      tx.set(ledgerRef, {
        uid,
        type: "admin_balance_adjust",
        amountCents,
        beforeBalanceCents,
        afterBalanceCents,
        createdAt: serverTimestamp(),
        ref: ledgerRef.id,
        adminUid,
        meta: { reason: reason ?? null },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

