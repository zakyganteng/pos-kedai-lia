package model

type Line struct {
	ID   string `json:"id" db:"id"`
	Code string `json:"code" db:"code"`
	Name string `json:"name" db:"name"`
	Type string `json:"type" db:"type"`
}

type User struct {
	ID            string `json:"id" db:"id"`
	Name          string `json:"name" db:"name"`
	Email         string `json:"email" db:"email"`
	Role          string `json:"role" db:"role"`
	Active        bool   `json:"active" db:"active"`
	BusinessLines []Line `json:"businessLines" db:"-"`
	PasswordHash  string `json:"-" db:"password_hash"`
}
