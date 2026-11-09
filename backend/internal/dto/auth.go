package dto

import (
	"pos/internal/model"
	"time"
)

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SessionResponse struct {
	AccessToken string     `json:"accessToken"`
	TokenType   string     `json:"tokenType"`
	ExpiresAt   time.Time  `json:"expiresAt"`
	User        model.User `json:"user"`
}
