package payment

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

// XenditQRISProvider adalah implementasi QRISProvider yang beneran manggil
// API Xendit (bukan simulasi). BELUM diaktifkan/dipakai di router.go sekarang,
// karena kita belum punya API key Xendit. Cara mengaktifkan nanti:
//
//  1. Daftar akun di https://dashboard.xendit.co, ambil Secret API Key
//     (mode Test dulu buat development, nggak perlu akun yang sudah diaktivasi)
//  2. Set environment variable XENDIT_SECRET_KEY dan XENDIT_CALLBACK_URL
//  3. Di router.go, ganti baris:
//     qrisProvider := payment.NewLocalQRISProvider()
//     jadi:
//     qrisProvider := payment.NewXenditQRISProvider(os.Getenv("XENDIT_SECRET_KEY"), os.Getenv("XENDIT_CALLBACK_URL"))
//
// Referensi API: https://developers.xendit.co/api-reference/#create-qr-code
// (Endpoint QR Codes V1: POST https://api.xendit.co/qr_codes)
type XenditQRISProvider struct {
	secretKey   string
	callbackURL string
}

func NewXenditQRISProvider(secretKey, callbackURL string) *XenditQRISProvider {
	return &XenditQRISProvider{secretKey: secretKey, callbackURL: callbackURL}
}

type xenditQRRequest struct {
	ExternalID  string  `json:"external_id"`
	Type        string  `json:"type"`
	CallbackURL string  `json:"callback_url"`
	Amount      float64 `json:"amount"`
}

type xenditQRResponse struct {
	ID         string `json:"id"`
	QRString   string `json:"qr_string"`
	ExternalID string `json:"external_id"`
}

func (p *XenditQRISProvider) CreateQR(externalID string, amount float64) (string, string, error) {
	reqBody := xenditQRRequest{
		ExternalID:  externalID,
		Type:        "DYNAMIC",
		CallbackURL: p.callbackURL,
		Amount:      amount,
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", "", err
	}

	req, err := http.NewRequest("POST", "https://api.xendit.co/qr_codes", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", "", err
	}
	req.SetBasicAuth(p.secretKey, "")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("xendit API mengembalikan status %d", resp.StatusCode)
	}

	var result xenditQRResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}
	return result.ID, result.QRString, nil
}
