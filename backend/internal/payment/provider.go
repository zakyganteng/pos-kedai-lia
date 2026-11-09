package payment

// QRISProvider adalah kontrak yang harus dipenuhi penyedia pembayaran QRIS.
// Sengaja dibikin interface, biar LocalQRISProvider (simulasi, dipakai sekarang)
// bisa diganti jadi XenditQRISProvider (API beneran) nanti tanpa mengubah
// kode di service/handler sama sekali, cukup ganti satu baris waktu wiring
// di router.go.
type QRISProvider interface {
	// CreateQR menghasilkan qris_id (referensi unik) dan qr_string (data QR code)
	// buat satu transaksi dengan nominal tertentu.
	CreateQR(externalID string, amount float64) (qrisID string, qrString string, err error)
}
