import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuth, getFirestore, serverTimestamp } from "@/lib/firebase/admin";
import { requireFirebaseAuth } from "@/lib/auth/requireFirebaseAuth";
import { BET_STEPS, simulateSuperAceSpin } from "@/lib/game/superAce";

const bodySchema = z.object({
  bet: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(6).optional(),
  mode: z.enum(["paid", "free"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { uid } = await requireFirebaseAuth(req);
    const firestore = getFirestore();
    const auth = getAuth();

    // Deny if Firebase account is disabled.
    const authUser = await auth.getUser(uid);
    if (authUser.disabled) {
      return NextResponse.json({ error: "USER_DISABLED" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const bet = parsed.data.bet;
    const mode = parsed.data.mode ?? "paid";
    if (!BET_STEPS.includes(bet as (typeof BET_STEPS)[number])) {
      return NextResponse.json({ error: "Invalid bet amount." }, { status: 400 });
    }

    const idempotencyKey = parsed.data.idempotencyKey ?? randomUUID();
    const betCents = bet * 100;

    // Pre-simulate outside the transaction so we can reuse the outcome on commit.
    const spinResult = simulateSuperAceSpin({ betCents });
    let freeSpinsAwardedNow = 0;

    const spinIdempotencyRef = firestore
      .collection("spinIdempotency")
      .doc(idempotencyKey);

    const spinRef = firestore.collection("spins").doc();
    const ledgerDebitRef = firestore.collection("ledgerEntries").doc();
    const ledgerCreditRef = firestore.collection("ledgerEntries").doc();

    let spinId: string | null = null;

    await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(spinIdempotencyRef);
      if (existing.exists) {
        spinId = existing.data()?.spinId ?? null;
        return;
      }

      const userRef = firestore.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      const banned = userSnap.exists && userSnap.data()?.banned === true;
      if (banned) {
        throw new Error("USER_BANNED");
      }
      const balanceCents =
        userSnap.exists && typeof userSnap.data()?.balanceCents === "number"
          ? (userSnap.data()!.balanceCents as number)
          : 0;

      const freeSpins =
        userSnap.exists && typeof userSnap.data()?.freeSpins === "number"
          ? (userSnap.data()!.freeSpins as number)
          : 0;

      const totalWinCents = spinResult.totalWinCents;
      let newBalanceCents = balanceCents;
      let newFreeSpins = freeSpins;

      if (mode === "paid") {
        if (balanceCents < betCents) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        newBalanceCents = balanceCents - betCents + totalWinCents;
      } else {
        if (freeSpins < 1) {
          throw new Error("NO_FREE_SPINS");
        }
        newBalanceCents = balanceCents + totalWinCents;
        newFreeSpins = freeSpins - 1;
      }

      // Award additional free spins on scatter trigger.
      // Only award on paid spins when the user currently has no active free spins.
      // This prevents re-triggering during free games.
      const freeSpinsToAwardNow =
        mode === "paid" && freeSpins < 1 ? spinResult.freeSpinsAwarded : 0;
      freeSpinsAwardedNow = freeSpinsToAwardNow;
      newFreeSpins += freeSpinsToAwardNow;

      // Update user balance
      tx.set(
        userRef,
        {
          balanceCents: newBalanceCents,
          freeSpins: newFreeSpins,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Ledger: bet debit
      if (mode === "paid") {
        tx.set(ledgerDebitRef, {
          uid,
          type: "spin_bet_debit",
          amountCents: -betCents,
          beforeBalanceCents: balanceCents,
          afterBalanceCents: balanceCents - betCents,
          createdAt: serverTimestamp(),
          ref: spinRef.id,
        });
      }

      const payoutBeforeBalanceCents =
        mode === "paid" ? balanceCents - betCents : balanceCents;

      // Ledger: payout credit
      tx.set(ledgerCreditRef, {
        uid,
        type: mode === "paid" ? "spin_payout_credit" : "spin_free_payout_credit",
        amountCents: totalWinCents,
        beforeBalanceCents: payoutBeforeBalanceCents,
        afterBalanceCents: newBalanceCents,
        createdAt: serverTimestamp(),
        ref: spinRef.id,
      });

      // Spin record for audit + animation
      tx.set(spinRef, {
        uid,
        createdAt: serverTimestamp(),
        betCents,
        totalWinCents,
        mode,
        scatterCount: spinResult.scatterCount,
        freeSpinsAwarded: freeSpinsAwardedNow,
        specialCardTriggered: spinResult.specialCardTriggered,
        specialCardDoubled: spinResult.specialCardDoubled,
        // Firestore does not allow nested arrays, so we store grids/steps as JSON strings.
        initialGridJson: JSON.stringify(spinResult.initialGrid),
        stepsJson: JSON.stringify(spinResult.steps),
        finalGridJson: JSON.stringify(spinResult.finalGrid),
        bet: bet,
        idempotencyKey,
      });

      tx.set(spinIdempotencyRef, {
        uid,
        createdAt: serverTimestamp(),
        spinId: spinRef.id,
        betCents,
      });

      spinId = spinRef.id;
    });

    if (!spinId) {
      return NextResponse.json(
        { error: "Could not settle spin." },
        { status: 500 }
      );
    }

    const spinSnap = await firestore.collection("spins").doc(spinId).get();
    if (!spinSnap.exists) {
      return NextResponse.json(
        { error: "Spin record not found." },
        { status: 500 }
      );
    }

    const spinData = spinSnap.data()!;

    const userSnap = await firestore.collection("users").doc(uid).get();
    const balanceCents =
      userSnap.exists && typeof userSnap.data()?.balanceCents === "number"
        ? (userSnap.data()!.balanceCents as number)
        : 0;
    const freeSpins =
      userSnap.exists && typeof userSnap.data()?.freeSpins === "number"
        ? (userSnap.data()!.freeSpins as number)
        : 0;

    return NextResponse.json({
      ok: true,
      uid,
      idempotencyKey,
      balanceCents,
      balance: balanceCents / 100,
      betCents,
      totalWinCents: spinData.totalWinCents,
      initialGrid:
        typeof spinData.initialGridJson === "string"
          ? JSON.parse(spinData.initialGridJson)
          : spinData.initialGrid,
      steps:
        typeof spinData.stepsJson === "string" ? JSON.parse(spinData.stepsJson) : spinData.steps,
      finalGrid:
        typeof spinData.finalGridJson === "string"
          ? JSON.parse(spinData.finalGridJson)
          : spinData.finalGrid,
      freeSpinsLeft: freeSpins,
      scatterCount: spinData.scatterCount ?? 0,
      freeSpinsAwarded: spinData.freeSpinsAwarded ?? 0,
      specialCardTriggered: Boolean(spinData.specialCardTriggered),
      specialCardDoubled: Boolean(spinData.specialCardDoubled),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    const status =
      message === "INSUFFICIENT_BALANCE"
        ? 400
        : message === "USER_BANNED"
          ? 403
          : message === "NO_FREE_SPINS"
            ? 400
            : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

