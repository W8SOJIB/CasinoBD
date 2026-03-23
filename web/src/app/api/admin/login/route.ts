import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";

import { getFirestore, serverTimestamp } from "@/lib/firebase/admin";
import { createAdminSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/adminSession";

const loginSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(6).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const firestore = getFirestore();

    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid login payload." }, { status: 400 });
    }

    const { username, password } = parsed.data;

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: "ADMIN_USERNAME and ADMIN_PASSWORD must be set." },
        { status: 500 }
      );
    }

    const adminDocRef = firestore.collection("adminUsers").doc(username);
    const adminSnap = await adminDocRef.get();

    // Seed-first-run: only allow seeding for the configured admin username.
    if (!adminSnap.exists) {
      if (username !== adminUsername) {
        return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
      }
      if (password !== adminPassword) {
        return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await adminDocRef.set({
        username,
        passwordHash,
        createdAt: serverTimestamp(),
      });
    }

    const adminData = (await adminDocRef.get()).data() as
      | { username: string; passwordHash: string }
      | undefined;
    if (!adminData?.passwordHash) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, adminData.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const token = createAdminSessionToken({ username });

    const res = NextResponse.json({ ok: true });

    // httpOnly session cookie for admin endpoints.
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Allow the browser to open /admin and redirect to /login if you want later.
export async function GET() {
  return NextResponse.json({ ok: true });
}

