package crypto

import "testing"

func TestCrypto(t *testing.T) {
	tok, err := RandomToken(32)
	if err != nil || len(tok) != 43 {
		t.Fatalf("RandomToken failed: %v, len=%d", err, len(tok))
	}

	pass := "supersecret123"
	hash, err := HashPassword(pass)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}

	if !ComparePassword(hash, pass) {
		t.Fatalf("ComparePassword failed to match correct password")
	}

	if ComparePassword(hash, "wrongpassword") {
		t.Fatalf("ComparePassword matched wrong password")
	}

	dummy := DummyBcryptHash("seed")
	if len(dummy) == 0 {
		t.Fatalf("DummyBcryptHash empty")
	}

	sh := SHA256("test")
	if sh != "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" {
		t.Fatalf("SHA256 mismatch: got %s", sh)
	}
}
