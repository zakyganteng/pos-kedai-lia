-- Migration awal: skema basis data POS Kedai Lia 287 & Salon Lia
-- Berdasarkan ERD revisi (setelah masukan T-7 dan M-11)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Outlet: satu sistem menaungi dua jenis usaha (kedai & salon)
CREATE TABLE outlet (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama VARCHAR(100) NOT NULL,
    kategori_usaha VARCHAR(20) NOT NULL CHECK (kategori_usaha IN ('kedai', 'salon')),
    alamat TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Pengguna: Owner (outlet_id null = akses semua outlet), Admin, Kasir
CREATE TABLE pengguna (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID REFERENCES outlet(id),
    nama VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'kasir')),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Karyawan: yang mengerjakan layanan salon (bukan akun login sistem)
CREATE TABLE karyawan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES outlet(id),
    nama VARCHAR(100) NOT NULL,
    no_hp VARCHAR(20),
    posisi VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Item: gabungan produk (kedai) dan layanan (salon), dibedakan lewat kolom type
CREATE TABLE item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES outlet(id),
    nama VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('product', 'service')),
    harga DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Inventory: HANYA dipakai item bertipe product, salon tidak akan punya baris di sini
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID UNIQUE NOT NULL REFERENCES item(id),
    stok INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Transaksi
CREATE TABLE transaksi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES outlet(id),
    pengguna_id UUID NOT NULL REFERENCES pengguna(id),
    kode_transaksi VARCHAR(20) UNIQUE NOT NULL,
    tanggal TIMESTAMP NOT NULL DEFAULT now(),
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'selesai', 'dibatalkan'))
);

-- Detail transaksi: karyawan_id & durasi_menit hanya terisi kalau item-nya bertipe service
CREATE TABLE detail_transaksi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaksi_id UUID NOT NULL REFERENCES transaksi(id),
    item_id UUID NOT NULL REFERENCES item(id),
    karyawan_id UUID REFERENCES karyawan(id),
    jumlah INTEGER NOT NULL DEFAULT 1,
    harga_satuan DECIMAL(12,2) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    durasi_menit INTEGER
);

-- Pembayaran: relasi satu-ke-satu ke transaksi
CREATE TABLE pembayaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaksi_id UUID UNIQUE NOT NULL REFERENCES transaksi(id),
    metode VARCHAR(20) NOT NULL CHECK (metode IN ('tunai', 'qris')),
    status VARCHAR(20) NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'berhasil', 'gagal')),
    qris_id VARCHAR(100),
    qr_string TEXT,
    paid_at TIMESTAMP
);

-- Pengeluaran: biaya operasional per outlet
CREATE TABLE pengeluaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES outlet(id),
    dicatat_oleh UUID NOT NULL REFERENCES pengguna(id),
    kategori VARCHAR(50) NOT NULL,
    jumlah DECIMAL(12,2) NOT NULL,
    tanggal TIMESTAMP NOT NULL DEFAULT now(),
    keterangan TEXT
);

CREATE INDEX idx_transaksi_outlet ON transaksi(outlet_id);
CREATE INDEX idx_detail_transaksi_transaksi ON detail_transaksi(transaksi_id);
CREATE INDEX idx_item_outlet ON item(outlet_id);
