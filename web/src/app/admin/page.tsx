"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DepositWithdrawRequest = {
  id: string;
  uid: string;
  type: "deposit" | "withdraw";
  amountCents: number;
  status: string;
  note?: string | null;
};

type AdminUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  banned: boolean;
  balanceCents: number;
  updatedAt: unknown;
};

type TabKey = "requests" | "users" | "adjust";

function formatUnits(cents: number) {
  return (cents / 100).toFixed(2);
}

function creditsToCents(credits: number) {
  return Math.round(credits * 100);
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => null)) as unknown;
}

export default function AdminPage() {
  const [adminUsername, setAdminUsername] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("requests");

  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);

  const [requests, setRequests] = useState<DepositWithdrawRequest[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>("");

  const selectedUser = useMemo(
    () => users.find((u) => u.uid === selectedUid) ?? null,
    [users, selectedUid]
  );

  const [balanceEditCredits, setBalanceEditCredits] = useState<string>("0");

  const [adjustUid, setAdjustUid] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("100");
  const [adjustReason, setAdjustReason] = useState("Admin adjustment");

  useEffect(() => {
    void checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
    setBalanceEditCredits((selectedUser.balanceCents / 100).toFixed(2));
  }, [selectedUser]);

  async function api<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const res = await fetch(path, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });

    const data = await safeJson(res);
    if (!res.ok) {
      const maybeObj = data as Record<string, unknown> | null;
      const message =
        maybeObj && typeof maybeObj.error === "string"
          ? String(maybeObj.error)
          : `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data as T;
  }

  async function checkSession() {
    setSessionChecked(false);
    setErr(null);
    try {
      const data = await api<{ ok: boolean; username?: string }>(
        "/api/admin/session",
        { method: "GET" }
      );
      if (data.ok && typeof data.username === "string") {
        setAdminUsername(data.username);
        setLoginErr(null);
      } else {
        setAdminUsername(null);
      }
    } catch {
      setAdminUsername(null);
    } finally {
      setSessionChecked(true);
    }
  }

  async function refreshRequests() {
    const data = await api<{ requests: DepositWithdrawRequest[] }>(
      "/api/admin/requests",
      { method: "GET" }
    );
    setRequests(data.requests ?? []);
  }

  async function refreshUsers() {
    const data = await api<{ users: AdminUser[] }>("/api/admin/users?limit=200", {
      method: "GET",
    });
    setUsers(data.users ?? []);
    if (!selectedUid && (data.users ?? []).length > 0) {
      setSelectedUid((data.users ?? [])[0]!.uid);
    }
  }

  useEffect(() => {
    if (!adminUsername) return;
    void Promise.all([refreshRequests(), refreshUsers()]).catch((e) => {
      setErr(e instanceof Error ? e.message : "Failed to refresh admin data");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUsername]);

  async function login() {
    setBusy(true);
    setErr(null);
    setLoginErr(null);
    try {
      if (!loginUsername.trim() || !loginPassword) {
        throw new Error("Enter admin username and password.");
      }

      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });

      setLoginPassword("");
      await checkSession();
    } catch (e) {
      setLoginErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setAdminUsername(null);
    setSessionChecked(true);
  }

  async function decide(requestId: string, action: "approve" | "reject") {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/requests", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          action,
          adminNote: action === "approve" ? "Approved" : "Rejected",
        }),
      });
      await refreshRequests();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateSelectedUser(patch: Record<string, unknown>) {
    if (!selectedUser) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/users/${selectedUser.uid}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await refreshUsers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyBalanceEdit() {
    const credits = Number(balanceEditCredits);
    if (!Number.isFinite(credits)) {
      setErr("Invalid balance input.");
      return;
    }
    const cents = creditsToCents(credits);
    await updateSelectedUser({ balanceCents: cents });
  }

  async function submitAdjust() {
    setBusy(true);
    setErr(null);
    try {
      const credits = Number(adjustAmount);
      if (!Number.isFinite(credits) || credits === 0) {
        throw new Error("Enter a non-zero adjustment amount.");
      }
      const amountCents = creditsToCents(credits);
      await api("/api/admin/adjust", {
        method: "POST",
        body: JSON.stringify({
          uid: adjustUid.trim(),
          amountCents,
          reason: adjustReason || null,
        }),
      });
      await refreshUsers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Adjust failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelectedUser() {
    if (!selectedUser) return;
    const answer = window.prompt("Type REMOVE to delete this user.");
    if (answer !== "REMOVE") return;
    await updateSelectedUser({ remove: true });
  }

  if (!sessionChecked || !adminUsername) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white px-4">
        <div className="w-full max-w-sm border border-gray-800 rounded-lg bg-gray-950/60 p-5">
          <div className="title-font text-4xl tracking-widest uppercase mb-2 text-center">
            Admin
          </div>
          <div className="text-xs text-gray-400 text-center mb-4">
            Login to manage users and approve deposits/withdrawals.
          </div>

          {loginErr ? <div className="text-red-400 text-sm mb-3">{loginErr}</div> : null}
          {err ? <div className="text-red-400 text-sm mb-3">{err}</div> : null}

          <label className="block text-sm text-gray-300 mb-1">Username</label>
          <input
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-3 text-white"
            type="text"
          />

          <label className="block text-sm text-gray-300 mb-1">Password</label>
          <input
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-4 text-white"
            type="password"
          />

          <button
            disabled={busy}
            onClick={() => void login()}
            className="w-full rounded bg-yellow-500 text-black font-bold py-2 disabled:opacity-60"
            type="button"
          >
            {busy ? "Checking..." : "Login"}
          </button>

          <div className="text-center text-xs text-gray-400 mt-4">
            Use your admin credentials configured in Netlify env vars.
          </div>

          <div className="text-center text-xs text-gray-400 mt-2">
            <Link href="/login" className="underline text-gray-300">
              User login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="title-font text-3xl tracking-widest uppercase mb-1">
              Admin Panel
            </div>
            <div className="text-xs text-gray-400">
              {adminUsername} • approve deposit/withdraw + manage users
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs underline text-gray-300">
              Game
            </Link>
            <button
              onClick={() => void logout()}
              className="rounded px-2 py-1 bg-gray-900 border border-gray-700 hover:bg-gray-800 text-xs"
              type="button"
            >
              Logout
            </button>
          </div>
        </div>

        {err ? <div className="mb-4 text-red-400 text-sm">{err}</div> : null}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab("requests")}
            className={`px-3 py-1 rounded border text-xs ${
              tab === "requests"
                ? "bg-yellow-500 text-black border-yellow-500"
                : "border-gray-700 text-gray-200"
            }`}
          >
            Pending Requests
          </button>
          <button
            type="button"
            onClick={() => setTab("users")}
            className={`px-3 py-1 rounded border text-xs ${
              tab === "users"
                ? "bg-yellow-500 text-black border-yellow-500"
                : "border-gray-700 text-gray-200"
            }`}
          >
            Users
          </button>
          <button
            type="button"
            onClick={() => setTab("adjust")}
            className={`px-3 py-1 rounded border text-xs ${
              tab === "adjust"
                ? "bg-yellow-500 text-black border-yellow-500"
                : "border-gray-700 text-gray-200"
            }`}
          >
            Balance Adjust
          </button>
        </div>

        {tab === "requests" ? (
          <div className="border border-gray-800 rounded-lg bg-gray-950/60 p-4">
            <div className="text-sm text-gray-300 mb-3 font-bold">Pending Deposit/Withdraw</div>
            {requests.length === 0 ? (
              <div className="text-sm text-gray-500">No pending requests.</div>
            ) : (
              <div className="space-y-3">
                {requests.map((r) => (
                  <div key={r.id} className="border border-gray-800 rounded p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-bold">{r.type}</span>{" "}
                        <span className="text-gray-300">{formatUnits(r.amountCents)}</span>
                        <div className="text-xs text-gray-500 break-all mt-1">
                          User: {r.uid}
                        </div>
                      </div>
                      <div className="text-xs font-bold text-yellow-400">{r.status}</div>
                    </div>
                    {r.note ? (
                      <div className="text-xs text-gray-400 mt-2">{r.note}</div>
                    ) : null}
                    <div className="flex gap-2 mt-3">
                      <button
                        disabled={busy}
                        onClick={() => void decide(r.id, "approve")}
                        className="flex-1 rounded bg-green-600 text-white font-bold py-2 disabled:opacity-60 text-sm"
                        type="button"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void decide(r.id, "reject")}
                        className="flex-1 rounded bg-red-600 text-white font-bold py-2 disabled:opacity-60 text-sm"
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <button
                disabled={busy}
                onClick={() => void refreshRequests()}
                className="text-xs underline text-gray-300"
                type="button"
              >
                Refresh
              </button>
            </div>
          </div>
        ) : null}

        {tab === "users" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-gray-800 rounded-lg bg-gray-950/60 p-4">
              <div className="text-sm text-gray-300 mb-3 font-bold">Registered Users</div>
              {users.length === 0 ? (
                <div className="text-sm text-gray-500">No users found.</div>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
                  {users.map((u) => {
                    const active = u.uid === selectedUid;
                    return (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => setSelectedUid(u.uid)}
                        className={`w-full text-left border border-gray-800 rounded p-3 ${
                          active ? "bg-gray-800" : "bg-transparent hover:bg-gray-900/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs">
                            <div className="font-bold text-white">
                              {u.displayName || "User"}
                            </div>
                            <div className="text-gray-300 break-all">
                              {u.email || u.uid}
                            </div>
                            <div className="text-gray-500 text-[11px] break-all mt-1">
                              {u.uid}
                            </div>
                          </div>
                          <div className="text-[11px] text-right">
                            <div className={u.banned ? "text-red-400 font-bold" : "text-green-400 font-bold"}>
                              {u.banned ? "BANNED" : "OK"}
                            </div>
                            <div className={u.disabled ? "text-yellow-400 font-bold" : "text-gray-500 font-bold"}>
                              {u.disabled ? "DISABLED" : "ACTIVE"}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-3">
                <button
                  type="button"
                  className="text-xs underline text-gray-300"
                  onClick={() => void refreshUsers()}
                  disabled={busy}
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="border border-gray-800 rounded-lg bg-gray-950/60 p-4">
              <div className="text-sm text-gray-300 mb-3 font-bold">Edit User</div>
              {!selectedUser ? (
                <div className="text-sm text-gray-500">Select a user.</div>
              ) : (
                <>
                  <div className="text-xs text-gray-300 mb-3 break-all">
                    UID: {selectedUser.uid}
                  </div>

                  <div className="text-xs text-gray-300 mb-1">Balance</div>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={balanceEditCredits}
                      onChange={(e) => setBalanceEditCredits(e.target.value)}
                      className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white text-sm"
                      type="text"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void applyBalanceEdit()}
                      className="rounded px-3 py-2 bg-yellow-500 text-black font-bold text-sm disabled:opacity-60"
                    >
                      Set
                    </button>
                  </div>

                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void updateSelectedUser({ banned: !selectedUser.banned })
                      }
                      className={`flex-1 rounded px-3 py-2 font-bold text-sm disabled:opacity-60 ${
                        selectedUser.banned ? "bg-green-700" : "bg-red-700"
                      }`}
                    >
                      {selectedUser.banned ? "Unban" : "Ban"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void updateSelectedUser({ disabled: !selectedUser.disabled })
                      }
                      className={`flex-1 rounded px-3 py-2 font-bold text-sm disabled:opacity-60 ${
                        selectedUser.disabled ? "bg-gray-800" : "bg-yellow-700"
                      }`}
                    >
                      {selectedUser.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeSelectedUser()}
                    className="w-full rounded px-3 py-2 bg-red-900 text-white font-bold disabled:opacity-60 text-sm"
                  >
                    Remove User (Delete)
                  </button>

                  <div className="text-xs text-gray-500 mt-3">
                    Note: Remove deletes the Firebase Auth user + Firestore user doc.
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === "adjust" ? (
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

            <div className="text-xs text-gray-500 mt-3">
              Tip: you can also ban/unban and set balance inside the Users tab.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

