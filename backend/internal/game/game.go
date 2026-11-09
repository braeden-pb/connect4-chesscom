// Package game implements the rules of Connect Four without transport or storage dependencies.
package game

import "errors"

const (
	Rows    = 6
	Columns = 7
)

type Player uint8

const (
	Empty Player = iota
	Red
	Yellow
)

type Status string

const (
	InProgress Status = "in_progress"
	Won        Status = "won"
	Draw       Status = "draw"
)

var (
	ErrInvalidColumn = errors.New("column must be between 0 and 6")
	ErrColumnFull    = errors.New("column is full")
	ErrGameOver      = errors.New("game is over")
)

// Game is a self-contained, in-memory game. Zero-based column indexes are used.
// Fields are private to prevent callers from bypassing the rules.
type Game struct {
	board   [Rows][Columns]Player
	turn    Player
	status  Status
	winner  Player
	moves   int
	history []int
}

func New() *Game { return &Game{turn: Red, status: InProgress} }

// Board returns a copy, so callers cannot mutate the game state directly.
func (g *Game) Board() [Rows][Columns]Player { return g.board }
func (g *Game) Turn() Player                 { return g.turn }
func (g *Game) Status() Status               { return g.status }

// Winner is Empty unless a player has won.
func (g *Game) Winner() Player { return g.winner }
func (g *Game) Moves() int     { return g.moves }
func (g *Game) History() []int { return append([]int{}, g.history...) }

// Drop places the current player's disc in the lowest available row of column.
// It returns the row where the disc landed. Invalid moves leave state unchanged.
func (g *Game) Drop(column int) (int, error) {
	if g.status != InProgress {
		return -1, ErrGameOver
	}
	if column < 0 || column >= Columns {
		return -1, ErrInvalidColumn
	}

	row := Rows - 1
	for row >= 0 && g.board[row][column] != Empty {
		row--
	}
	if row < 0 {
		return -1, ErrColumnFull
	}

	player := g.turn
	g.board[row][column] = player
	g.moves++
	g.history = append(g.history, column)

	if g.hasWon(row, column, player) {
		g.status = Won
		g.winner = player
	} else if g.moves == Rows*Columns {
		g.status = Draw
	} else if player == Red {
		g.turn = Yellow
	} else {
		g.turn = Red
	}
	return row, nil
}

func (g *Game) hasWon(row, column int, player Player) bool {
	for _, d := range [][2]int{{1, 0}, {0, 1}, {1, 1}, {1, -1}} {
		count := 1 + g.count(row, column, d[0], d[1], player) + g.count(row, column, -d[0], -d[1], player)
		if count >= 4 {
			return true
		}
	}
	return false
}

func (g *Game) count(row, column, dr, dc int, player Player) int {
	n := 0
	for r, c := row+dr, column+dc; r >= 0 && r < Rows && c >= 0 && c < Columns && g.board[r][c] == player; r, c = r+dr, c+dc {
		n++
	}
	return n
}
