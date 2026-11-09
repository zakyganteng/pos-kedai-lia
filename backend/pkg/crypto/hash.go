package crypto

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
)

// SHA256 returns hex-encoded sha256 checksum of the input string.
func SHA256(v string) string {
	h := sha256.Sum256([]byte(v))
	return hex.EncodeToString(h[:])
}

// RandomToken generates a cryptographically secure URL-safe base64 token of n random bytes.
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// VerifyHMACSHA256 verifies an HMAC-SHA256 signature against secret.
func VerifyHMACSHA256(body []byte, signature, secret string) error {
	signature = strings.TrimPrefix(signature, "sha256=")
	actual, err := hex.DecodeString(signature)
	if err != nil || len(actual) != sha256.Size {
		return errors.New("invalid signature")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), actual) {
		return errors.New("invalid signature")
	}
	return nil
}
