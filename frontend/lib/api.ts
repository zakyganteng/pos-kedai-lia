import type { Item, Pengguna } from "@/types";

// Di Docker, frontend manggil backend lewat nama service "backend" (bukan
// localhost), karena mereka jalan di container terpisah tapi satu jaringan
// Docker yang sama. Saat development langsung di laptop (npm run dev, tanpa
// Docker), biasanya tetap localhost. Env var ini yang bikin dua skenario itu
// sama-sama bisa jalan tanpa ubah kode.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8090";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Terjadi kesalahan" }));
    throw new ApiError(body.error || `Request gagal (status ${res.status})`, res.status);
  }

  // DELETE /items/{id} sengaja tidak mengembalikan body (204 No Content)
  if (res.status === 204) return undefined as T;

  return res.json();
}

export interface LoginResponse {
  token: string;
  pengguna: Pengguna;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getItems(token: string, outletId: string): Promise<Item[]> {
  return apiFetch<Item[]>(`/items?outlet_id=${outletId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
