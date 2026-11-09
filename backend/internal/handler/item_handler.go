package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/username/pos-kedai-lia/backend/internal/model"
	"github.com/username/pos-kedai-lia/backend/internal/service"
)

type ItemHandler struct {
	service *service.ItemService
}

func NewItemHandler(s *service.ItemService) *ItemHandler {
	return &ItemHandler{service: s}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, pesan string) {
	writeJSON(w, status, map[string]string{"error": pesan})
}

func (h *ItemHandler) List(w http.ResponseWriter, r *http.Request) {
	outletID := r.URL.Query().Get("outlet_id")
	if outletID == "" {
		writeError(w, http.StatusBadRequest, "outlet_id wajib diisi sebagai query parameter")
		return
	}
	items, err := h.service.List(outletID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "gagal mengambil data item")
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *ItemHandler) Create(w http.ResponseWriter, r *http.Request) {
	var item model.Item
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeError(w, http.StatusBadRequest, "format JSON tidak valid")
		return
	}
	created, err := h.service.Create(item)
	if err != nil {
		if errors.Is(err, service.ErrTypeTidakValid) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "gagal menyimpan item")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *ItemHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	item, err := h.service.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "item tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *ItemHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var item model.Item
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeError(w, http.StatusBadRequest, "format JSON tidak valid")
		return
	}
	item.ID = id
	if err := h.service.Update(item); err != nil {
		if errors.Is(err, service.ErrTypeTidakValid) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "gagal memperbarui item")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"pesan": "item berhasil diperbarui"})
}

func (h *ItemHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.service.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, "gagal menghapus item")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
