FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# NEXT_PUBLIC_API_URL harus di-set SAAT BUILD (bukan cuma saat run), karena
# Next.js "menanam" nilai NEXT_PUBLIC_* ke dalam kode JavaScript yang dikirim
# ke browser pengguna pada waktu build, bukan dibaca ulang saat container jalan.
ARG NEXT_PUBLIC_API_URL=http://localhost:8090
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
