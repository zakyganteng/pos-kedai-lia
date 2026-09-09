package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()

	// Endpoint pengecekan awal, buat mastiin server hidup
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ok",
			"pesan":  "POS Kedai Lia 287 & Salon Lia API berjalan",
		})
	})

	log.Println("Server jalan di http://localhost:8090")
	log.Fatal(http.ListenAndServe(":8090", mux))
}
