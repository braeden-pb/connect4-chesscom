package repository

import (
	"connect4/internal/game"
	"context"
	"errors"
)

var ErrNotFound = errors.New("game not found")

// Store owns persistence. ApplyMove must be atomic for each game.
type Store interface {
	Create(context.Context) (string, *game.Game, error)
	Get(context.Context, string) (*game.Game, error)
	ApplyMove(context.Context, string, int) (*game.Game, int, error)
}
