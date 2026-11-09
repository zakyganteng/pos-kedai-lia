package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/username/pos-kedai-lia/backend/internal/model"
	"github.com/username/pos-kedai-lia/backend/internal/notification"
	"github.com/username/pos-kedai-lia/backend/internal/payment"
	"github.com/username/pos-kedai-lia/backend/internal/repository"
)

var (
	ErrItemKosong      = errors.New("transaksi harus punya minimal 1 item")
	ErrMetodeTidakValid = errors.New("metode pembayaran harus 'tunai' atau 'qris'")
)

type ItemTransaksiInput struct {
	ItemID     string
	Jumlah     int
	KaryawanID *string
	Durasi     *int
}

type TransaksiService struct {
	trxRepo        *repository.TransaksiRepository
	itemRepo       *repository.ItemRepository
	pembayaranRepo *repository.PembayaranRepository
	qrisProvider   payment.QRISProvider
	notifier       notification.Notifier
}

func NewTransaksiService(
	trxRepo *repository.TransaksiRepository,
	itemRepo *repository.ItemRepository,
	pembayaranRepo *repository.PembayaranRepository,
	qrisProvider payment.QRISProvider,
	notifier notification.Notifier,
) *TransaksiService {
	return &TransaksiService{
		trxRepo: trxRepo, itemRepo: itemRepo,
		pembayaranRepo: pembayaranRepo, qrisProvider: qrisProvider, notifier: notifier,
	}
}

type HasilTransaksi struct {
	Transaksi model.Transaksi
	Detail    []model.DetailTransaksi
	Metode    string
	QRString  *string
}

func (s *TransaksiService) Buat(outletID, penggunaID, metode string, items []ItemTransaksiInput) (HasilTransaksi, error) {
	if len(items) == 0 {
		return HasilTransaksi{}, ErrItemKosong
	}
	if metode != "tunai" && metode != "qris" {
		return HasilTransaksi{}, ErrMetodeTidakValid
	}

	// Ambil harga ASLI dari database per item (jangan pernah percaya harga
	// yang dikirim dari frontend/klien, biar nggak bisa dimanipulasi orang
	// buat bayar lebih murah dari harga sebenarnya).
	var total float64
	details := make([]model.DetailTransaksi, 0, len(items))
	for _, in := range items {
		item, err := s.itemRepo.FindByID(in.ItemID)
		if err != nil {
			return HasilTransaksi{}, fmt.Errorf("item %s tidak ditemukan", in.ItemID)
		}
		subtotal := item.Harga * float64(in.Jumlah)
		total += subtotal
		details = append(details, model.DetailTransaksi{
			ItemID:      in.ItemID,
			KaryawanID:  in.KaryawanID,
			Jumlah:      in.Jumlah,
			HargaSatuan: item.Harga,
			Subtotal:    subtotal,
			DurasiMenit: in.Durasi,
		})
	}

	kodeTransaksi := fmt.Sprintf("TRX-%s-%s", time.Now().Format("20060102"), randomKode())

	trx := model.Transaksi{
		OutletID:      outletID,
		PenggunaID:    penggunaID,
		KodeTransaksi: kodeTransaksi,
		Total:         total,
		Status:        "pending",
	}

	createdTrx, createdDetails, err := s.trxRepo.CreateWithDetail(trx, details)
	if err != nil {
		return HasilTransaksi{}, err
	}

	hasil := HasilTransaksi{Transaksi: createdTrx, Detail: createdDetails, Metode: metode}

	if metode == "tunai" {
		// Tunai dianggap lunas seketika, kasir pegang uangnya langsung
		if _, err := s.pembayaranRepo.Create(createdTrx.ID, "tunai", "berhasil", nil, nil); err != nil {
			return HasilTransaksi{}, err
		}
		if err := s.trxRepo.UpdateStatus(createdTrx.ID, "selesai"); err != nil {
			return HasilTransaksi{}, err
		}
		hasil.Transaksi.Status = "selesai"
		s.kirimNotifikasi(createdTrx.KodeTransaksi, total)
		return hasil, nil
	}

	// Metode QRIS: generate QR lewat provider (simulasi lokal atau Xendit asli)
	qrisID, qrString, err := s.qrisProvider.CreateQR(createdTrx.KodeTransaksi, total)
	if err != nil {
		return HasilTransaksi{}, fmt.Errorf("gagal membuat QRIS: %w", err)
	}
	if _, err := s.pembayaranRepo.Create(createdTrx.ID, "qris", "menunggu", &qrisID, &qrString); err != nil {
		return HasilTransaksi{}, err
	}
	hasil.QRString = &qrString
	return hasil, nil
}

func (s *TransaksiService) Get(id string) (model.Transaksi, []model.DetailTransaksi, error) {
	trx, err := s.trxRepo.FindByID(id)
	if err != nil {
		return model.Transaksi{}, nil, err
	}
	details, err := s.trxRepo.FindDetailByTransaksiID(id)
	if err != nil {
		return model.Transaksi{}, nil, err
	}
	return trx, details, nil
}

func (s *TransaksiService) List(outletID string) ([]model.Transaksi, error) {
	return s.trxRepo.FindAll(outletID)
}

// KonfirmasiPembayaranQRIS dipanggil dari webhook (baik simulasi lokal
// maupun webhook Xendit asli nanti, formatnya sengaja disamakan).
func (s *TransaksiService) KonfirmasiPembayaranQRIS(qrisID string) error {
	transaksiID, err := s.pembayaranRepo.MarkBerhasil(qrisID)
	if err != nil {
		return err
	}
	if err := s.trxRepo.UpdateStatus(transaksiID, "selesai"); err != nil {
		return err
	}
	trx, err := s.trxRepo.FindByID(transaksiID)
	if err == nil {
		s.kirimNotifikasi(trx.KodeTransaksi, trx.Total)
	}
	return nil
}

// kirimNotifikasi memberi tahu pemilik usaha soal transaksi yang baru selesai.
// Nomor tujuan sengaja di-hardcode dulu (belum ada tabel pengaturan outlet
// buat nomor WA pemilik), ini catatan buat dikembangkan lagi nanti.
func (s *TransaksiService) kirimNotifikasi(kodeTransaksi string, total float64) {
	pesan := fmt.Sprintf("Transaksi %s berhasil, total Rp%.0f", kodeTransaksi, total)
	_ = s.notifier.KirimNotifikasiTransaksi("owner-outlet", pesan)
}

func randomKode() string {
	return fmt.Sprintf("%d", time.Now().UnixNano()%1000000)
}
