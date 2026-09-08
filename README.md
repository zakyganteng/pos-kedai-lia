# POS Kedai Lia 287 & Salon Lia

Sistem Point of Sale multi-outlet buat Kedai Lia 287 (kuliner) dan Salon Lia (jasa kecantikan), dikembangkan pakai metode PXP sebagai tugas akhir.

## Stack
- Backend: Golang (net/http)
- Frontend: Next.js
- Database: PostgreSQL
- Pembayaran: QRIS via Xendit
- Notifikasi: WhatsApp Business API

## Struktur
- `backend/` — REST API
- `frontend/` — dashboard kasir & owner
- `backend/migrations/` — skema database, urutan dieksekusi sesuai nomor file

## Menjalankan backend (development)
```
cd backend
go run cmd/api/main.go
```
Cek di `http://localhost:8080/health`

## Status pengembangan
Lihat commit history, tiap branch `feature/*` mewakili satu iterasi PXP.
