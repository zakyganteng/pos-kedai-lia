package jwt

import (
	"testing"
	"time"
)

func TestJWTGenerateAndVerify(t *testing.T) {
	secret := "super-secret-jwt-key-for-testing"
	now := time.Now().UTC().Truncate(time.Second)
	token, exp, err := Generate(secret, "user-123", "owner", "jti-abc", 30*time.Minute, now)
	if err != nil || token == "" {
		t.Fatalf("Generate failed: %v", err)
	}
	if !exp.Equal(now.Add(30 * time.Minute)) {
		t.Fatalf("unexpected expiry: %v", exp)
	}

	claims, err := Verify(secret, token)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}
	if claims.UserID != "user-123" || claims.Role != "owner" || claims.ID != "jti-abc" {
		t.Fatalf("unexpected claims: %+v", claims)
	}

	if _, err := Verify("wrong-secret", token); err == nil {
		t.Fatalf("accepted wrong secret")
	}
}
