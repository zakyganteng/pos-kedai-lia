package payment

import (
	"crypto/rand"
	"fmt"
)

// LocalQRISProvider adalah simulasi QRIS buat development/testing di laptop,
// TANPA butuh akun Xendit beneran. qr_string yang dihasilkan BUKAN QR code
// asli yang bisa discan HP, cuma teks placeholder biar alur sistemnya bisa
// dites penuh dari ujung ke ujung.
type LocalQRISProvider struct{}

func NewLocalQRISProvider() *LocalQRISProvider {
	return &LocalQRISProvider{}
}

func (p *LocalQRISProvider) CreateQR(externalID string, amount float64) (string, string, error) {
	qrisID := "SIMULASI-" + randomHex(8)
	qrString := fmt.Sprintf("QRIS-SIMULASI|external_id=%s|amount=%.0f|qris_id=%s", externalID, amount, qrisID)
	return qrisID, qrString, nil
}

func randomHex(n int) string {
	b := make([]byte, n/2)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
