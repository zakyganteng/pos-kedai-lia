package handler

import (
	"encoding/json"
	"net/http"
	"time"
	"pos-kedai-lia/backend/internal/model"
	"pos-kedai-lia/backend/internal/repository"
)

type PengeluaranHandler struct {
	Repo *repository.PengeluaranRepository
}

func NewPengeluaranHandler(repo *repository.PengeluaranRepository) *PengeluaranHandler {
	return &PengeluaranHandler{Repo: repo}
}

// CatatPengeluaran menangani request POST /pengeluaran
func (h *PengeluaranHandler) CatatPengeluaran(w http.ResponseWriter, r *http.Request) {
	// Pastikan hanya menerima metode POST
	if r.Method != http.MethodPost {
		http.Error(w, "Metode tidak diizinkan", http.StatusMethodNotAllowed)
		return
	}

	var p model.Pengeluaran
	// Mengubah data JSON dari Next.js menjadi struct Golang
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, "Format data salah", http.StatusBadRequest)
		return
	}

	// Atur waktu pencatatan secara otomatis saat ini juga
	p.Tanggal = time.Now()

	// Panggil fungsi simpan di repository
	if err := h.Repo.TambahPengeluaran(p); err != nil {
		http.Error(w, "Gagal menyimpan pengeluaran: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Beri tahu Next.js bahwa penyimpanan sukses
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Pengeluaran berhasil dicatat!"})
}

// LihatPengeluaran menangani request GET /pengeluaran
func (h *PengeluaranHandler) LihatPengeluaran(w http.ResponseWriter, r *http.Request) {
	// Pastikan hanya menerima metode GET
	if r.Method != http.MethodGet {
		http.Error(w, "Metode tidak diizinkan", http.StatusMethodNotAllowed)
		return
	}

	// Ambil data dari database melalui repository
	data, err := h.Repo.AmbilSemuaPengeluaran()
	if err != nil {
		http.Error(w, "Gagal mengambil data", http.StatusInternalServerError)
		return
	}

	// Jika kosong, kembalikan array kosong agar frontend tidak error
	if data == nil {
		data = []model.Pengeluaran{}
	}

	// Kirim data ke Next.js dalam format JSON
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}