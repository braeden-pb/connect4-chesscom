package repository

import (
	"connect4/internal/game"
	"context"
	"errors"
)

var ErrNotFound = errors.New("game not found")
var ErrAlreadyJoined = errors.New("both player seats are already filled")
var ErrNotOnline = errors.New("game is not an online match")
var ErrInvalidPlayerToken = errors.New("invalid player token")
var ErrWaitingForPlayer = errors.New("waiting for the second player to join")
var ErrGameNotFinished = errors.New("game is not finished")
var ErrRematchStarted = errors.New("rematch has already started")

type Match struct {
	Game          *game.Game
	Online        bool
	PlayersJoined int
	RematchID     string
}

// Store owns persistence. ApplyMove must be atomic for each game.
type Store interface {
	Create(context.Context) (string, *game.Game, error)
	CreateOnline(context.Context) (string, *game.Game, string, error)
	Get(context.Context, string) (*Match, error)
	Join(context.Context, string) (string, error)
	Rematch(context.Context, string, string) (string, *game.Game, string, int, int, error)
	ApplyMove(context.Context, string, int, string) (*Match, int, error)
}
