"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  type UserCredential,
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
      if (u) router.push("/");
    });
    return () => unsub();
  }, [router]);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const auth = getFirebaseAuth();
      let cred: UserCredential;
      if (mode === "signin") {
        cred = await signInWithEmailAndPassword(auth, email, password);
      } else {
        cred = await createUserWithEmailAndPassword(auth, email, password);
      }
      void cred;
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white px-4">
      <div className="w-full max-w-sm border border-gray-800 rounded-lg bg-gray-950/60 p-5">
        <div className="title-font text-4xl tracking-widest uppercase mb-2 text-center">
          Super<span className="text-yellow-500">Ace</span>
        </div>
        <div className="text-center text-sm text-gray-300 mb-5">
          {mode === "signin" ? "Sign in to play" : "Create your account"}
        </div>

        <div className="flex gap-2 mb-4 justify-center">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`px-3 py-1 rounded border ${
              mode === "signin" ? "bg-yellow-500 text-black border-yellow-500" : "border-gray-700 text-gray-200"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`px-3 py-1 rounded border ${
              mode === "signup" ? "bg-yellow-500 text-black border-yellow-500" : "border-gray-700 text-gray-200"
            }`}
          >
            Sign up
          </button>
        </div>

        <label className="block text-sm mb-1 text-gray-300">Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-3 text-white"
          type="email"
          autoComplete="email"
        />

        <label className="block text-sm mb-1 text-gray-300">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-black border border-gray-800 rounded px-3 py-2 mb-4 text-white"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />

        {error ? <div className="text-red-400 text-sm mb-3">{error}</div> : null}

        <button
          type="button"
          disabled={loading}
          onClick={submit}
          className="w-full rounded bg-yellow-500 text-black font-bold py-2 disabled:opacity-60"
        >
          {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="text-center text-xs text-gray-400 mt-4">
          After login you can open <a href="/wallet" className="underline text-gray-300">Wallet</a> and <a href="/admin" className="underline text-gray-300">Admin</a>.
        </div>
      </div>
    </div>
  );
}

