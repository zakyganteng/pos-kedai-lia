module github.com/username/pos-kedai-lia/backend

go 1.22

require (
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/lib/pq v1.12.3
	golang.org/x/crypto v0.24.0
)

replace golang.org/x/crypto => github.com/golang/crypto v0.24.0
