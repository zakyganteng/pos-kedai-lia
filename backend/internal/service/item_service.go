package service

import (
	"errors"

	"github.com/username/pos-kedai-lia/backend/internal/model"
	"github.com/username/pos-kedai-lia/backend/internal/repository"
)

var ErrTypeTidakValid = errors.New("type harus 'product' atau 'service'")

type ItemService struct {
	itemRepo      *repository.ItemRepository
	inventoryRepo *repository.InventoryRepository
}

func NewItemService(itemRepo *repository.ItemRepository, inventoryRepo *repository.InventoryRepository) *ItemService {
	return &ItemService{itemRepo: itemRepo, inventoryRepo: inventoryRepo}
}

func (s *ItemService) Create(item model.Item) (model.Item, error) {
	if item.Type != "product" && item.Type != "service" {
		return model.Item{}, ErrTypeTidakValid
	}

	created, err := s.itemRepo.Create(item)
	if err != nil {
		return model.Item{}, err
	}

	if created.Type == "product" {
		if err := s.inventoryRepo.CreateForItem(created.ID); err != nil {
			return model.Item{}, err
		}
	}

	return created, nil
}

func (s *ItemService) List(outletID string) ([]model.Item, error) {
	return s.itemRepo.FindAll(outletID)
}

func (s *ItemService) Get(id string) (model.Item, error) {
	return s.itemRepo.FindByID(id)
}

func (s *ItemService) Update(item model.Item) error {
	if item.Type != "product" && item.Type != "service" {
		return ErrTypeTidakValid
	}
	return s.itemRepo.Update(item)
}

func (s *ItemService) Delete(id string) error {
	return s.itemRepo.Delete(id)
}
