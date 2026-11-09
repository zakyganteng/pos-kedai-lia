"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Pengguna } from "@/types";

interface AuthState {
  token: string | null;
  pengguna: Pengguna | null;
  loading: boolean;
  setAuth: (token: string, pengguna: Pengguna) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

// Dipanggil sekali di root layout, bungkus seluruh aplikasi, biar status
// login bisa diakses dari halaman mana saja lewat hook useAuth().
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [pengguna, setPengguna] = useState<Pengguna | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Saat halaman pertama kali dibuka, cek apakah sebelumnya sudah pernah
  // login (tersimpan di localStorage), biar tidak perlu login ulang tiap
  // refresh halaman.
  useEffect(() => {
    const savedToken = localStorage.getItem("pos_token");
    const savedPengguna = localStorage.getItem("pos_pengguna");
    if (savedToken && savedPengguna) {
      setToken(savedToken);
      setPengguna(JSON.parse(savedPengguna));
    }
    setLoading(false);
  }, []);

  function setAuth(newToken: string, newPengguna: Pengguna) {
    localStorage.setItem("pos_token", newToken);
    localStorage.setItem("pos_pengguna", JSON.stringify(newPengguna));
    setToken(newToken);
    setPengguna(newPengguna);
  }

  function logout() {
    localStorage.removeItem("pos_token");
    localStorage.removeItem("pos_pengguna");
    setToken(null);
    setPengguna(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ token, pengguna, loading, setAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}
