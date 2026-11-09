const money = new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
});
const dates = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
});

export function rupiah(value: number): string {
  return money.format(value);
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Tanggal tidak tersedia" : dates.format(date);
}

export function paymentLabel(status: string): string {
  return ({ pending: "Menunggu pembayaran", confirmed: "Pembayaran berhasil", failed: "Pembayaran gagal", expired: "Pembayaran kedaluwarsa", voided: "Pembayaran dibatalkan" } as Record<string, string>)[status] ?? status;
}

export function saleLabel(status: string): string {
  return ({ pending_payment: "Menunggu pembayaran", paid: "Lunas", cancelled: "Dibatalkan", voided: "Dibatalkan setelah pembayaran" } as Record<string, string>)[status] ?? status;
}
