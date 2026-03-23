"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";

import { getFirebaseAuth } from "@/lib/firebase/client";

type DepositWithdrawRequest = {
  id: string;
  uid: string;
  type: "deposit" | "withdraw";
  amountCents: number;
  status: "pending" | "approved" | "rejected";
  note?: string | null;
  createdAt?: unknown;
};

function formatUnits(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function WalletPage() {
  const [user, setUser] = useState<User | null>(null);
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [requests, setRequests] = useState<DepositWithdrawRequest[]>([]);
  const [amountInput, setAmountInput] = useState<string>("10");
  const [noteInput, setNoteInput] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => setUser(u));
    return () => unsub();
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    const idToken = await user.getIdToken();

    const balRes = await fetch("/api/balance", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const balData = await balRes.json().catch(() => null);
    if (balRes.ok && typeof balData?.balanceCents === "number") {
      setBalanceCents(balData.balanceCents);
    }

    const reqRes = await fetch("/api/wallet/requests", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const reqData = await reqRes.json().catch(() => null);
    if (reqRes.ok && Array.isArray(reqData?.requests)) {
      setRequests(reqData.requests as DepositWithdrawRequest[]);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  async function submitRequest(type: "deposit" | "withdraw") {
    if (!user) return;
    setBusy(true);
    setErr(null);
    try {
      const credits = Number(amountInput);
      if (!Number.isFinite(credits) || credits <= 0) {
        throw new Error("Enter a valid amount.");
      }
      const amountCents = Math.round(credits * 100);
      const idToken = await user.getIdToken();

      const res = await fetch("/api/wallet/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          type,
          amountCents,
          note: noteInput || null,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Request failed.");
      }
      void data;
      setAmountInput("10");
      setNoteInput("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white px-4">
        <div className="text-center max-w-sm">
          <div className="title-font text-3xl tracking-widest uppercase mb-4">
            Wallet Login
          </div>
          <a href="/login" className="underline text-yellow-400">
            Go to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex justify-center px-4">
      <div className="w-full max-w-md py-8">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="title-font text-2xl tracking-widest uppercase">
              Wallet
            </div>
            <div className="text-sm text-gray-300">
              Current balance:{" "}
              <span className="text-yellow-400 font-mono">
                {formatUnits(balanceCents)}
              </span>
            </div>
          </div>
          <Link href="/" className="text-sm text-gray-300 underline">
            Back to game
          </Link>
        </div>

        <div className="border border-gray-800 rounded-lg p-4 bg-gray-950/60 mb-4">
          <div className="text-sm text-gray-300 mb-2">Deposit / Withdraw Request</div>

          <label className="block text-sm text-gray-300 mb-1">Amount (credits)</label>
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-gray-300 mb-1">Note (optional)</label>
          <input
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-3"
          />

          {err ? <div className="text-red-400 text-sm mb-3">{err}</div> : null}

          <div className="flex gap-3">
            <button
              disabled={busy}
              onClick={() => void submitRequest("deposit")}
              className="flex-1 rounded bg-yellow-500 text-black font-bold py-2 disabled:opacity-60"
            >
              Request Deposit
            </button>
            <button
              disabled={busy}
              onClick={() => void submitRequest("withdraw")}
              className="flex-1 rounded bg-gray-800 border border-gray-700 text-white font-bold py-2 disabled:opacity-60"
            >
              Request Withdraw
            </button>
          </div>
        </div>

        <div className="border border-gray-800 rounded-lg p-4 bg-gray-950/60">
          <div className="text-sm text-gray-300 mb-3">Your Requests</div>
          {requests.length === 0 ? (
            <div className="text-sm text-gray-500">No requests yet.</div>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="border border-gray-800 rounded p-3 bg-gray-900/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-bold">{r.type}</span>{" "}
                      <span className="text-gray-300">
                        {formatUnits(r.amountCents)}
                      </span>
                    </div>
                    <div
                      className={`text-xs font-bold ${
                        r.status === "approved"
                          ? "text-green-400"
                          : r.status === "rejected"
                            ? "text-red-400"
                            : "text-yellow-400"
                      }`}
                    >
                      {r.status}
                    </div>
                  </div>
                  {r.note ? (
                    <div className="text-xs text-gray-400 mt-1 truncate">
                      Note: {r.note}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

