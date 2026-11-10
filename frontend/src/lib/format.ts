const money = new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
});
const numbers = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
});
const dayOnly = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeZone: "Asia/Jakarta",
});
const timeOnly = new Intl.DateTimeFormat("id-ID", {
  timeStyle: "short", timeZone: "Asia/Jakarta",
});
/** en-CA formats as YYYY-MM-DD, which is the API date format. */
const isoDay = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Jakarta",
});

export function rupiah(value: number): string {
  return money.format(value);
}

export function count(value: number): string {
  return numbers.format(value);
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Tanggal tidak tersedia" : dates.format(date);
}

export function timeOfDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeOnly.format(date);
}

/** Formats an API `YYYY-MM-DD` business date for display. */
export function businessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // Noon UTC stays on the same calendar day in Asia/Jakarta.
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dayOnly.format(date);
}

/** Today's business date (Asia/Jakarta) as `YYYY-MM-DD`. */
export function todayBusinessDate(now: Date = new Date()): string {
  return isoDay.format(now);
}

/** Business date `days` before/after `from` (default today), as `YYYY-MM-DD`. */
export function shiftBusinessDate(days: number, from: string = todayBusinessDate()): string {
  const date = new Date(`${from}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay.format(date);
}

/** First day of the business month containing `from` (default today). */
export function monthStart(from: string = todayBusinessDate()): string {
  return `${from.slice(0, 7)}-01`;
}

export function paymentLabel(status: string): string {
  return ({ pending: "Menunggu pembayaran", confirmed: "Pembayaran berhasil", failed: "Pembayaran gagal", expired: "Pembayaran kedaluwarsa", voided: "Pembayaran dibatalkan" } as Record<string, string>)[status] ?? status;
}

export function saleLabel(status: string): string {
  return ({ pending_payment: "Menunggu pembayaran", paid: "Lunas", cancelled: "Dibatalkan", voided: "Dibatalkan setelah pembayaran" } as Record<string, string>)[status] ?? status;
}

export function paymentMethodLabel(method: string): string {
  return ({ cash: "Tunai", qris: "QRIS" } as Record<string, string>)[method] ?? method;
}

export function roleLabel(role: string): string {
  return ({ owner: "Pemilik", admin: "Admin", cashier: "Kasir" } as Record<string, string>)[role] ?? role;
}

export function queueStatusLabel(status: string): string {
  return ({ waiting: "Menunggu", in_service: "Sedang dilayani", completed: "Selesai", cancelled: "Dibatalkan" } as Record<string, string>)[status] ?? status;
}

export function notificationStatusLabel(status: string): string {
  return ({ queued: "Dalam antrean kirim", sent: "Terkirim", failed: "Gagal terkirim" } as Record<string, string>)[status] ?? status;
}

export function movementTypeLabel(type: string): string {
  return ({ receive: "Penerimaan", adjustment: "Penyesuaian", sale: "Penjualan", reversal: "Pengembalian" } as Record<string, string>)[type] ?? type;
}

export function reconciliationOutcomeLabel(outcome: string): string {
  return ({
    applied: "Diterapkan",
    duplicate_state: "Status sama (duplikat)",
    mismatch: "Tidak cocok",
    terminal_conflict: "Konflik status akhir",
    unmatched: "Tanpa transaksi",
    stale: "Kedaluwarsa",
    unresolved: "Belum terselesaikan",
  } as Record<string, string>)[outcome] ?? outcome;
}

export function providerStatusLabel(status: string): string {
  return ({ succeeded: "Berhasil", failed: "Gagal", expired: "Kedaluwarsa" } as Record<string, string>)[status] ?? status;
}

/** Short, still unique-enough form of a UUID for dense tables. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.slice(0, 8);
}
