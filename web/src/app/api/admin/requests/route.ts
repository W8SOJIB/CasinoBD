import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getFirestore, serverTimestamp } from "@/lib/firebase/admin";
import { requireAdminSession } from "@/lib/auth/adminSession";

const approveSchema = z.object({
  requestId: z.string().min(6),
  action: z.enum(["approve", "reject"]),
  adminNote: z.string().max(300).optional(),
});

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);

    const firestore = getFirestore();
    const q = await firestore
      .collection("depositWithdrawRequests")
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const requests = q.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
    return NextResponse.json({ requests });
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
    const adminUid = session.username;

    const firestore = getFirestore();
    const body = await req.json().catch(() => null);
    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { requestId, action, adminNote } = parsed.data;

    const requestRef = firestore.collection("depositWithdrawRequests").doc(requestId);
    const ledgerRef = firestore.collection("ledgerEntries").doc();

    await firestore.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) {
        throw new Error("REQUEST_NOT_FOUND");
      }
      const request = requestSnap.data() as {
        uid: string;
        type: "deposit" | "withdraw";
        amountCents: number;
        status: string;
      };

      if (request.status !== "pending") {
        throw new Error("REQUEST_NOT_PENDING");
      }

      const userRef = firestore.collection("users").doc(request.uid);
      const userSnap = await tx.get(userRef);
      const balanceCents =
        userSnap.exists && typeof userSnap.data()?.balanceCents === "number"
          ? (userSnap.data()!.balanceCents as number)
          : 0;

      if (action === "approve") {
        const delta =
          request.type === "deposit" ? request.amountCents : -request.amountCents;

        if (delta < 0 && balanceCents < Math.abs(delta)) {
          throw new Error("INSUFFICIENT_USER_BALANCE");
        }

        const newBalanceCents = balanceCents + delta;

        tx.set(
          userRef,
          { balanceCents: newBalanceCents, updatedAt: serverTimestamp() },
          { merge: true }
        );

        tx.set(ledgerRef, {
          uid: request.uid,
          type:
            request.type === "deposit"
              ? "admin_deposit_approved_credit"
              : "admin_withdraw_approved_debit",
          amountCents: delta,
          beforeBalanceCents: balanceCents,
          afterBalanceCents: newBalanceCents,
          createdAt: serverTimestamp(),
          ref: requestRef.id,
          adminUid,
          meta: { note: adminNote ?? null },
        });

        tx.set(
          requestRef,
          {
            status: "approved",
            decidedAt: serverTimestamp(),
            decidedBy: adminUid,
            adminNote: adminNote ?? null,
          },
          { merge: true }
        );
      } else {
        tx.set(
          requestRef,
          {
            status: "rejected",
            decidedAt: serverTimestamp(),
            decidedBy: adminUid,
            adminNote: adminNote ?? null,
          },
          { merge: true }
        );
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    const status = message === "REQUEST_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

