package config

import "os"

type Config struct {
	DatabaseURL string
	Port        string
}

func Load() Config {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5433/pos_kedai_lia?sslmode=disable"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	return Config{DatabaseURL: dbURL, Port: port}
}
