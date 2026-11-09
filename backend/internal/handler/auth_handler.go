package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/username/pos-kedai-lia/backend/internal/model"
	"github.com/username/pos-kedai-lia/backend/internal/service"
)

type AuthHandler struct {
	service *service.AuthService
}

func NewAuthHandler(s *service.AuthService) *AuthHandler {
	return &AuthHandler{service: s}
}

type registerRequest struct {
	OutletID string `json:"outlet_id"`
	Nama     string `json:"nama"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "format JSON tidak valid")
		return
	}
	if req.Password == "" || len(req.Password) < 6 {
		writeError(w, http.StatusBadRequest, "password minimal 6 karakter")
		return
	}
	var outletID *string
	if req.OutletID != "" {
		outletID = &req.OutletID
	}
	pengguna := model.Pengguna{OutletID: outletID, Nama: req.Nama, Email: req.Email, Role: req.Role}
	created, err := h.service.Register(pengguna, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrRoleTidakValid), errors.Is(err, service.ErrEmailSudahDipakai):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "gagal mendaftarkan pengguna")
		}
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "format JSON tidak valid")
		return
	}
	token, pengguna, err := h.service.Login(req.Email, req.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"pengguna": map[string]string{
			"id": pengguna.ID, "nama": pengguna.Nama, "email": pengguna.Email, "role": pengguna.Role,
		},
	})
}
