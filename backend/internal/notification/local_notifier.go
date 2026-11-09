package notification

import "log"

// LocalNotifier "mengirim" notifikasi dengan cara nulis ke log server aja,
// nggak beneran ngirim WhatsApp. Dipakai buat development/testing sekarang.
type LocalNotifier struct{}

func NewLocalNotifier() *LocalNotifier {
	return &LocalNotifier{}
}

func (n *LocalNotifier) KirimNotifikasiTransaksi(nomorTujuan, pesan string) error {
	log.Printf("[SIMULASI WHATSAPP] Ke: %s | Pesan: %s\n", nomorTujuan, pesan)
	return nil
}
