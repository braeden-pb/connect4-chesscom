package repository

import (
	"connect4/internal/game"
	"errors"
	"slices"
	"testing"
)

func TestReplay(t *testing.T) {
	g, err := replay([]byte(`[0,1,0,1,0,1,0]`))
	if err != nil {
		t.Fatal(err)
	}
	if g.Status() != game.Won || g.Winner() != game.Red || g.Moves() != 7 {
		t.Fatal("wrong replay state")
	}
	if got := g.History(); !slices.Equal(got, []int{0, 1, 0, 1, 0, 1, 0}) {
		t.Fatalf("wrong replay history: %v", got)
	}
	for _, s := range []string{`null`, `{}`, `[7]`, `[0,1,0,1,0,1,0,2]`, `not json`} {
		if _, err := replay([]byte(s)); err == nil {
			t.Errorf("accepted %s", s)
		}
	}
	if _, err := replay([]byte(`[]`)); err != nil {
		t.Fatal(err)
	}
}
func TestIDs(t *testing.T) {
	a, err := newID()
	if err != nil {
		t.Fatal(err)
	}
	b, err := newID()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 36 || a == b {
		t.Fatal("invalid IDs")
	}
}

var _ = errors.Is
