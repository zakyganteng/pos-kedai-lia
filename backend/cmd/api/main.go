package main

import (
	"log"
	"net/http"

	"github.com/username/pos-kedai-lia/backend/internal/config"
	"github.com/username/pos-kedai-lia/backend/internal/middleware"
	"github.com/username/pos-kedai-lia/backend/internal/repository"
	"github.com/username/pos-kedai-lia/backend/internal/router"
)

func main() {
	cfg := config.Load()

	db, err := repository.OpenDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("gagal konek ke database: %v", err)
	}
	defer db.Close()
	log.Println("Berhasil konek ke database")

	mux := router.New(db)
	handler := middleware.CORS(mux)

	log.Printf("Server jalan di http://localhost:%s\n", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, handler))
}
