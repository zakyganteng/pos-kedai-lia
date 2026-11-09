package crypto

import "golang.org/x/crypto/bcrypt"

// HashPassword hashes a plain text password using bcrypt with standard cost 12.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(h), err
}

// ComparePassword compares a hashed password with a plain password.
func ComparePassword(hashedPassword, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password)) == nil
}

// DummyBcryptHash produces a dummy bcrypt hash used to prevent timing attacks on nonexistent users.
func DummyBcryptHash(seed string) []byte {
	dummy, _ := bcrypt.GenerateFromPassword([]byte(seed), 12)
	return dummy
}
