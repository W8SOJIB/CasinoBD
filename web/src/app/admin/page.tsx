"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Link from "next/link";

import { getFirebaseAuth } from "@/lib/firebase/client";

type DepositWithdrawRequest = {
  id: string;
  uid: string;
  type: "deposit" | "withdraw";
  amountCents: number;
  status: string;
  note?: string | null;
};

function formatUnits(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requests, setRequests] = useState<DepositWithdrawRequest[]>([]);

  const [adjustUid, setAdjustUid] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("100");
  const [adjustReason, setAdjustReason] = useState("Admin adjustment");

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => setUser(u));
    return () => unsub();
  }, []);

  async function refresh() {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch("/api/admin/requests", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "Failed to load admin requests");
      return;
    }
    setRequests((data?.requests as DepositWithdrawRequest[]) ?? []);
    setErr(null);
  }

  useEffect(() => {
    if (!user) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function setDecision(requestId: string, action: "approve" | "reject") {
    if (!user) return;
    setBusy(true);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestId,
          action,
          adminNote: action === "approve" ? "Approved" : "Rejected",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Decision failed");
      void data;
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjust() {
    if (!user) return;
    setBusy(true);
    setErr(null);
    try {
      const credits = Number(adjustAmount);
      if (!Number.isFinite(credits) || credits === 0) {
        throw new Error("Enter a non-zero adjustment amount.");
      }
      const amountCents = Math.round(credits * 100);
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/adjust", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uid: adjustUid.trim(),
          amountCents,
          reason: adjustReason || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Adjust failed");
      void data;
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Adjust failed");
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white px-4">
        <div className="text-center max-w-sm">
          <div className="title-font text-3xl tracking-widest uppercase mb-4">
            Admin
          </div>
          <a href="/login" className="underline text-yellow-400">
            Go to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="title-font text-3xl tracking-widest uppercase mb-1">
              Admin Panel
            </div>
            <div className="text-xs text-gray-400">
              Approve deposits/withdraw requests and adjust balances.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs underline text-gray-300">
              Game
            </Link>
            <button
              onClick={() => signOut(getFirebaseAuth())}
              className="rounded px-2 py-1 bg-gray-900 border border-gray-700 hover:bg-gray-800 text-xs"
            >
              Sign out
            </button>
          </div>
        </div>

        {err ? <div className="mb-4 text-red-400 text-sm">{err}</div> : null}

        <div className="border border-gray-800 rounded-lg bg-gray-950/60 p-4 mb-6">
          <div className="text-sm text-gray-300 mb-3 font-bold">Pending Requests</div>
          {requests.length === 0 ? (
            <div className="text-sm text-gray-500">No pending requests.</div>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => (
                <div key={r.id} className="border border-gray-800 rounded p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-bold">{r.type}</span>{" "}
                      <span className="text-gray-300">
                        {formatUnits(r.amountCents)}
                      </span>
                      <div className="text-xs text-gray-500 break-all mt-1">
                        User: {r.uid}
                      </div>
                    </div>
                    <div
                      className={`text-xs font-bold ${
                        r.status === "pending" ? "text-yellow-400" : "text-gray-300"
                      }`}
                    >
                      {r.status}
                    </div>
                  </div>
                  {r.note ? (
                    <div className="text-xs text-gray-400 mt-2">{r.note}</div>
                  ) : null}
                  <div className="flex gap-2 mt-3">
                    <button
                      disabled={busy}
                      onClick={() => void setDecision(r.id, "approve")}
                      className="flex-1 rounded bg-green-600 text-white font-bold py-2 disabled:opacity-60 text-sm"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void setDecision(r.id, "reject")}
                      className="flex-1 rounded bg-red-600 text-white font-bold py-2 disabled:opacity-60 text-sm"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <button
              disabled={busy}
              onClick={() => void refresh()}
              className="text-xs underline text-gray-300"
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="border border-gray-800 rounded-lg bg-gray-950/60 p-4">
          <div className="text-sm text-gray-300 mb-3 font-bold">Balance Adjust</div>

          <label className="block text-xs text-gray-400 mb-1">User UID</label>
          <input
            value={adjustUid}
            onChange={(e) => setAdjustUid(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-3 text-white text-sm"
            placeholder="uid..."
          />

          <label className="block text-xs text-gray-400 mb-1">
            Amount (credits, can be negative)
          </label>
          <input
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-3 text-white text-sm"
            placeholder="100"
          />

          <label className="block text-xs text-gray-400 mb-1">Reason</label>
          <input
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-4 text-white text-sm"
          />

          <button
            disabled={busy}
            onClick={() => void submitAdjust()}
            className="w-full rounded bg-yellow-500 text-black font-bold py-2 disabled:opacity-60"
            type="button"
          >
            Apply Adjustment
          </button>
        </div>
      </div>
    </div>
  );
}

