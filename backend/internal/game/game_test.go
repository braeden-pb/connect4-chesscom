package game

import (
	"errors"
	"slices"
	"testing"
)

func play(t *testing.T, g *Game, cols ...int) {
	t.Helper()
	for _, c := range cols {
		if _, err := g.Drop(c); err != nil {
			t.Fatalf("drop column %d: %v", c, err)
		}
	}
}

func TestNewGame(t *testing.T) {
	g := New()
	if g.Turn() != Red || g.Status() != InProgress || g.Winner() != Empty || g.Moves() != 0 {
		t.Fatal("incorrect initial state")
	}
	for _, row := range g.Board() {
		for _, p := range row {
			if p != Empty {
				t.Fatal("new board not empty")
			}
		}
	}
}

func TestGravityAndAlternatingTurns(t *testing.T) {
	g := New()
	for i, expected := range []Player{Red, Yellow, Red} {
		row, err := g.Drop(3)
		if err != nil || row != Rows-1-i || g.Board()[row][3] != expected {
			t.Fatalf("move %d: row=%d err=%v", i, row, err)
		}
	}
	if g.Turn() != Yellow || g.Moves() != 3 {
		t.Fatal("turn or move count incorrect")
	}
	board := g.Board()
	board[5][3] = Empty
	if g.Board()[5][3] != Red {
		t.Fatal("board getter exposed mutable state")
	}
}

func TestInvalidMovesDoNotChangeState(t *testing.T) {
	g := New()
	for _, col := range []int{-1, Columns} {
		if row, err := g.Drop(col); row != -1 || !errors.Is(err, ErrInvalidColumn) {
			t.Fatalf("column %d: row=%d err=%v", col, row, err)
		}
	}
	play(t, g, 0, 0, 0, 0, 0, 0)
	beforeBoard, beforeHistory, beforeTurn, beforeMoves := g.Board(), g.History(), g.Turn(), g.Moves()
	if row, err := g.Drop(0); row != -1 || !errors.Is(err, ErrColumnFull) {
		t.Fatalf("full column: row=%d err=%v", row, err)
	}
	if g.Board() != beforeBoard || g.Turn() != beforeTurn || g.Moves() != beforeMoves || !slices.Equal(g.History(), beforeHistory) {
		t.Fatal("invalid move mutated state")
	}
}

func TestHistoryIsOrderedAndCopied(t *testing.T) {
	g := New()
	play(t, g, 3, 1, 4)
	history := g.History()
	if !slices.Equal(history, []int{3, 1, 4}) {
		t.Fatalf("history = %v", history)
	}
	history[0] = 6
	if !slices.Equal(g.History(), []int{3, 1, 4}) {
		t.Fatal("history getter exposed mutable state")
	}
}

func TestWins(t *testing.T) {
	cases := []struct {
		name  string
		moves []int
	}{
		{"horizontal", []int{0, 0, 1, 1, 2, 2, 3}},
		{"vertical", []int{0, 1, 0, 1, 0, 1, 0}},
		{"diagonal_up", []int{0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 5, 3, 3}},
		{"diagonal_down", []int{3, 2, 2, 1, 4, 1, 1, 0, 4, 0, 5, 0, 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := New()
			play(t, g, tc.moves...)
			if g.Status() != Won || g.Winner() != Red {
				t.Fatalf("expected red win, got %s winner %d", g.Status(), g.Winner())
			}
			beforeBoard, beforeHistory, beforeTurn, beforeMoves := g.Board(), g.History(), g.Turn(), g.Moves()
			if _, err := g.Drop(6); !errors.Is(err, ErrGameOver) {
				t.Fatalf("expected game over, got %v", err)
			}
			if g.Board() != beforeBoard || g.Turn() != beforeTurn || g.Moves() != beforeMoves || !slices.Equal(g.History(), beforeHistory) {
				t.Fatal("move after win mutated state")
			}
		})
	}
}

func TestYellowCanWin(t *testing.T) {
	g := New()
	play(t, g, 6, 0, 6, 1, 5, 2, 5, 3)
	if g.Status() != Won || g.Winner() != Yellow {
		t.Fatalf("expected yellow win, got %s %d", g.Status(), g.Winner())
	}
}

// A known 42-move drawn position, with no four-in-a-row in any direction.
func TestDraw(t *testing.T) {
	g := New()
	cols := []int{2, 3, 6, 0, 1, 1, 6, 4, 0, 2, 3, 2, 4, 3, 3, 4, 0, 3, 5, 6, 1, 5, 5, 2, 2, 1, 3, 1, 6, 2, 5, 4, 6, 0, 6, 4, 4, 1, 5, 0, 0, 5}
	play(t, g, cols...)
	if g.Status() != Draw || g.Winner() != Empty || g.Moves() != 42 {
		t.Fatalf("expected draw, got status=%s winner=%d moves=%d", g.Status(), g.Winner(), g.Moves())
	}
	if _, err := g.Drop(0); !errors.Is(err, ErrGameOver) {
		t.Fatalf("expected game over after draw, got %v", err)
	}
}
