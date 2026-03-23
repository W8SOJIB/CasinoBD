import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getFirestore } from "@/lib/firebase/admin";
import { requireFirebaseAuth } from "@/lib/auth/requireFirebaseAuth";

export async function GET(req: NextRequest) {
  try {
    const { uid } = await requireFirebaseAuth(req);
    const firestore = getFirestore();
    const userRef = firestore.collection("users").doc(uid);
    const snap = await userRef.get();

    const balanceCents =
      snap.exists && typeof snap.data()?.balanceCents === "number"
        ? (snap.data()!.balanceCents as number)
        : 0;

    return NextResponse.json({
      uid,
      balanceCents,
      balance: balanceCents / 100,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

