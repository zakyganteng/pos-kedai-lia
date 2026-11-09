package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/username/pos-kedai-lia/backend/internal/auth"
	"github.com/username/pos-kedai-lia/backend/internal/middleware"
	"github.com/username/pos-kedai-lia/backend/internal/service"
)

type TransaksiHandler struct {
	service *service.TransaksiService
}

func NewTransaksiHandler(s *service.TransaksiService) *TransaksiHandler {
	return &TransaksiHandler{service: s}
}

type itemTransaksiRequest struct {
	ItemID     string  `json:"item_id"`
	Jumlah     int     `json:"jumlah"`
	KaryawanID *string `json:"karyawan_id,omitempty"`
	Durasi     *int    `json:"durasi_menit,omitempty"`
}

type createTransaksiRequest struct {
	OutletID string                  `json:"outlet_id"`
	Metode   string                  `json:"metode"`
	Items    []itemTransaksiRequest `json:"items"`
}

// Create menangani POST /transaksi
// Butuh login (RequireAuth), pengguna_id diambil dari token, BUKAN dari body
// request, biar nggak bisa dipalsukan orang lain.
func (h *TransaksiHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createTransaksiRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "format JSON tidak valid")
		return
	}

	claims, ok := r.Context().Value(middleware.ClaimsContextKey).(*auth.Claims)
	if !ok {
		writeError(w, http.StatusUnauthorized, "tidak terautentikasi")
		return
	}
	userID := claims.UserID

	items := make([]service.ItemTransaksiInput, len(req.Items))
	for i, it := range req.Items {
		items[i] = service.ItemTransaksiInput{
			ItemID: it.ItemID, Jumlah: it.Jumlah,
			KaryawanID: it.KaryawanID, Durasi: it.Durasi,
		}
	}

	hasil, err := h.service.Buat(req.OutletID, userID, req.Metode, items)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrItemKosong), errors.Is(err, service.ErrMetodeTidakValid):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	response := map[string]interface{}{
		"transaksi": hasil.Transaksi,
		"detail":    hasil.Detail,
		"metode":    hasil.Metode,
	}
	if hasil.QRString != nil {
		response["qr_string"] = *hasil.QRString
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *TransaksiHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	trx, details, err := h.service.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "transaksi tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"transaksi": trx, "detail": details})
}

func (h *TransaksiHandler) List(w http.ResponseWriter, r *http.Request) {
	outletID := r.URL.Query().Get("outlet_id")
	if outletID == "" {
		writeError(w, http.StatusBadRequest, "outlet_id wajib diisi")
		return
	}
	trxs, err := h.service.List(outletID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "gagal mengambil data transaksi")
		return
	}
	writeJSON(w, http.StatusOK, trxs)
}

type webhookQRISRequest struct {
	QrisID string `json:"qris_id"`
}

// KonfirmasiQRIS menangani POST /transaksi/webhook/qris
// Ini endpoint yang nanti dipanggil Xendit otomatis kalau pelanggan
// beneran bayar. Untuk sekarang (mode simulasi), kamu panggil ini manual
// buat mensimulasikan "pelanggan sudah bayar".
func (h *TransaksiHandler) KonfirmasiQRIS(w http.ResponseWriter, r *http.Request) {
	var req webhookQRISRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "format JSON tidak valid")
		return
	}
	if err := h.service.KonfirmasiPembayaranQRIS(req.QrisID); err != nil {
		writeError(w, http.StatusNotFound, "qris_id tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"pesan": "pembayaran dikonfirmasi, transaksi selesai"})
}
