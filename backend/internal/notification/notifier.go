package notification

// Notifier adalah kontrak buat kirim notifikasi transaksi ke pemilik usaha.
// Sekarang dipakai LocalNotifier (cuma nulis ke log), nanti tinggal ganti
// jadi WhatsAppNotifier (WhatsApp Business API asli) tanpa ubah kode di
// service/handler.
type Notifier interface {
	KirimNotifikasiTransaksi(nomorTujuan, pesan string) error
}
