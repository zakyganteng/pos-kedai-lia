package service

import (
	"errors"

	"github.com/username/pos-kedai-lia/backend/internal/auth"
	"github.com/username/pos-kedai-lia/backend/internal/model"
	"github.com/username/pos-kedai-lia/backend/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrRoleTidakValid    = errors.New("role harus 'owner', 'admin', atau 'kasir'")
	ErrEmailSudahDipakai = errors.New("email sudah terdaftar")
	ErrKredensialSalah   = errors.New("email atau password salah")
)

type AuthService struct {
	repo *repository.PenggunaRepository
}

func NewAuthService(repo *repository.PenggunaRepository) *AuthService {
	return &AuthService{repo: repo}
}

func (s *AuthService) Register(p model.Pengguna, passwordPolos string) (model.Pengguna, error) {
	if p.Role != "owner" && p.Role != "admin" && p.Role != "kasir" {
		return model.Pengguna{}, ErrRoleTidakValid
	}
	if _, err := s.repo.FindByEmail(p.Email); err == nil {
		return model.Pengguna{}, ErrEmailSudahDipakai
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(passwordPolos), bcrypt.DefaultCost)
	if err != nil {
		return model.Pengguna{}, err
	}
	p.PasswordHash = string(hash)
	return s.repo.Create(p)
}

func (s *AuthService) Login(email, passwordPolos string) (string, model.Pengguna, error) {
	p, err := s.repo.FindByEmail(email)
	if err != nil {
		return "", model.Pengguna{}, ErrKredensialSalah
	}
	if err := bcrypt.CompareHashAndPassword([]byte(p.PasswordHash), []byte(passwordPolos)); err != nil {
		return "", model.Pengguna{}, ErrKredensialSalah
	}
	token, err := auth.GenerateToken(p.ID, p.Role)
	if err != nil {
		return "", model.Pengguna{}, err
	}
	return token, p, nil
}
