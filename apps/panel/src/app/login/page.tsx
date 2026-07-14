"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await apiFetch(`/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) router.push("/");
    else setError(mode === "login" ? "Giriş başarısız" : "Kayıt başarısız");
  }

  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">
        {mode === "login" ? "Giriş" : "Kayıt"}
      </h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full rounded border p-2"
          type="email"
          placeholder="E-posta"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded border p-2"
          type="password"
          placeholder="Parola"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-black p-2 text-white" type="submit">
          {mode === "login" ? "Giriş yap" : "Kayıt ol"}
        </button>
      </form>
      <button
        className="mt-3 text-sm text-gray-600 underline"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "Hesabın yok mu? Kayıt ol" : "Zaten üye misin? Giriş yap"}
      </button>
    </main>
  );
}
