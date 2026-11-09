package router

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/username/pos-kedai-lia/backend/internal/handler"
	"github.com/username/pos-kedai-lia/backend/internal/middleware"
	"github.com/username/pos-kedai-lia/backend/internal/notification"
	"github.com/username/pos-kedai-lia/backend/internal/payment"
	"github.com/username/pos-kedai-lia/backend/internal/repository"
	"github.com/username/pos-kedai-lia/backend/internal/service"
)

func New(db *sql.DB) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ok",
			"pesan":  "POS Kedai Lia 287 & Salon Lia API berjalan",
		})
	})

	// --- Auth ---
	penggunaRepo := repository.NewPenggunaRepository(db)
	authService := service.NewAuthService(penggunaRepo)
	authHandler := handler.NewAuthHandler(authService)
	mux.HandleFunc("POST /auth/register", authHandler.Register)
	mux.HandleFunc("POST /auth/login", authHandler.Login)

	// --- Item ---
	itemRepo := repository.NewItemRepository(db)
	inventoryRepo := repository.NewInventoryRepository(db)
	itemService := service.NewItemService(itemRepo, inventoryRepo)
	itemHandler := handler.NewItemHandler(itemService)
	mux.HandleFunc("GET /items", middleware.RequireAuth(itemHandler.List))
	mux.HandleFunc("GET /items/{id}", middleware.RequireAuth(itemHandler.Get))
	mux.HandleFunc("POST /items", middleware.RequireAuth(middleware.RequireRole("owner", "admin")(itemHandler.Create)))
	mux.HandleFunc("PUT /items/{id}", middleware.RequireAuth(middleware.RequireRole("owner", "admin")(itemHandler.Update)))
	mux.HandleFunc("DELETE /items/{id}", middleware.RequireAuth(middleware.RequireRole("owner", "admin")(itemHandler.Delete)))

	// --- Transaksi ---
	trxRepo := repository.NewTransaksiRepository(db)
	pembayaranRepo := repository.NewPembayaranRepository(db)
	qrisProvider := payment.NewLocalQRISProvider() // ganti ke payment.NewXenditQRISProvider(...) kalau sudah ada akun Xendit
	notifier := notification.NewLocalNotifier()    // ganti ke notifier WhatsApp asli nanti
	trxService := service.NewTransaksiService(trxRepo, itemRepo, pembayaranRepo, qrisProvider, notifier)
	trxHandler := handler.NewTransaksiHandler(trxService)

	mux.HandleFunc("POST /transaksi", middleware.RequireAuth(trxHandler.Create))
	mux.HandleFunc("GET /transaksi", middleware.RequireAuth(trxHandler.List))
	mux.HandleFunc("GET /transaksi/{id}", middleware.RequireAuth(trxHandler.Get))
	// Webhook TIDAK pakai RequireAuth karena yang manggil nanti Xendit
	mux.HandleFunc("POST /transaksi/webhook/qris", trxHandler.KonfirmasiQRIS)

	// --- Pengeluaran ---
	// 1. Inisialisasi Repository dan Handler
	pengeluaranRepo := repository.NewPengeluaranRepository(db)
	pengeluaranHandler := handler.NewPengeluaranHandler(pengeluaranRepo)

	// 2. Daftarkan URL dengan proteksi middleware.RequireAuth dan format Go 1.22
	mux.HandleFunc("POST /pengeluaran", middleware.RequireAuth(pengeluaranHandler.CatatPengeluaran))
	mux.HandleFunc("GET /pengeluaran", middleware.RequireAuth(pengeluaranHandler.LihatPengeluaran))

	return mux
}