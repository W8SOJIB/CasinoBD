import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuth, getFirestore, serverTimestamp } from "@/lib/firebase/admin";
import { requireAdminSession } from "@/lib/auth/adminSession";

const updateSchema = z.object({
  banned: z.boolean().optional(),
  disabled: z.boolean().optional(),
  // Admin can directly set balance; this is for manual corrections.
  balanceCents: z.number().int().optional(),
  // If true: permanently remove auth user + delete Firestore doc.
  remove: z.boolean().optional(),
  // Allow optional profile fields stored under `users/{uid}.profile`.
  profile: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    requireAdminSession(req);

    const firestore = getFirestore();
    const auth = getAuth();

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const { banned, disabled, balanceCents, remove, profile } = parsed.data;
    const { uid } = await params;

    if (remove) {
      await auth.deleteUser(uid);
      await firestore.collection("users").doc(uid).delete();
      return NextResponse.json({ ok: true });
    }

    if (typeof disabled === "boolean") {
      await auth.updateUser(uid, { disabled });
    }

    const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (typeof banned === "boolean") update.banned = banned;
    if (typeof balanceCents === "number") update.balanceCents = balanceCents;
    if (profile) update.profile = profile;

    await firestore.collection("users").doc(uid).set(update, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    const status = message.includes("auth/") ? 400 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

