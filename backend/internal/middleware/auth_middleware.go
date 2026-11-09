package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/username/pos-kedai-lia/backend/internal/auth"
)

// CORS mengizinkan browser di origin manapun (localhost:3000, dsb) buat
// manggil API ini. Tanpa ini, browser modern BLOKIR request dari frontend
// ke backend kalau portnya beda, meskipun backend sebenarnya menyala normal
// (ini sering disalahartikan sebagai "server mati").
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Browser mengirim request "OPTIONS" dulu sebagai basa-basi buat
		// nanya izin (disebut preflight), sebelum request asli dikirim.
		// Kita cukup jawab "OK" di sini, tidak perlu diteruskan ke handler asli.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type contextKey string

const ClaimsContextKey contextKey = "claims"

func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, `{"error":"token tidak ditemukan, sertakan header Authorization: Bearer <token>"}`, http.StatusUnauthorized)
			return
		}
		tokenString := strings.TrimPrefix(header, "Bearer ")

		claims, err := auth.VerifyToken(tokenString)
		if err != nil {
			http.Error(w, `{"error":"token tidak valid atau sudah kedaluwarsa"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), ClaimsContextKey, claims)
		next(w, r.WithContext(ctx))
	}
}

func RequireRole(roles ...string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(ClaimsContextKey).(*auth.Claims)
			if !ok {
				http.Error(w, `{"error":"tidak terautentikasi"}`, http.StatusUnauthorized)
				return
			}
			for _, role := range roles {
				if claims.Role == role {
					next(w, r)
					return
				}
			}
			http.Error(w, `{"error":"akun kamu tidak punya izin akses fitur ini"}`, http.StatusForbidden)
		}
	}
}
