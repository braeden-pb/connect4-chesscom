package api

import (
	"connect4/internal/game"
	"connect4/internal/repository"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type Handler struct{ Store repository.Store }

type state struct {
	ID            string                               `json:"id"`
	Board         [game.Rows][game.Columns]game.Player `json:"board"`
	Turn          game.Player                          `json:"turn"`
	Status        game.Status                          `json:"status"`
	Winner        game.Player                          `json:"winner"`
	Moves         int                                  `json:"moves"`
	History       []int                                `json:"history"`
	Online        bool                                 `json:"online"`
	PlayersJoined int                                  `json:"playersJoined"`
}

func snapshot(id string, match *repository.Match) state {
	return state{
		ID: id, Board: match.Game.Board(), Turn: match.Game.Turn(), Status: match.Game.Status(),
		Winner: match.Game.Winner(), Moves: match.Game.Moves(), History: match.Game.History(),
		Online: match.Online, PlayersJoined: match.PlayersJoined,
	}
}
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(r.URL.Path, "/")
	if path == "api/games" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			fail(w, 405, "method not allowed")
			return
		}
		id, g, err := h.Store.Create(r.Context())
		if err != nil {
			fail(w, 500, "internal server error")
			return
		}
		w.Header().Set("Location", "/api/games/"+id)
		writeJSON(w, 201, snapshot(id, &repository.Match{Game: g}))
		return
	}
	if path == "api/games/online" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			fail(w, 405, "method not allowed")
			return
		}
		id, g, token, err := h.Store.CreateOnline(r.Context())
		if err != nil {
			fail(w, 500, "internal server error")
			return
		}
		w.Header().Set("Location", "/api/games/"+id)
		writeJSON(w, 201, struct {
			state
			PlayerToken string `json:"playerToken"`
			Player      int    `json:"player"`
		}{snapshot(id, &repository.Match{Game: g, Online: true, PlayersJoined: 1}), token, 1})
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) < 3 || len(parts) > 4 || parts[0] != "api" || parts[1] != "games" || !validID(parts[2]) {
		fail(w, 404, "not found")
		return
	}
	id := parts[2]
	if len(parts) == 3 {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			fail(w, 405, "method not allowed")
			return
		}
		match, err := h.Store.Get(r.Context(), id)
		if err != nil {
			storeError(w, err)
			return
		}
		writeJSON(w, 200, snapshot(id, match))
		return
	}
	if parts[3] == "join" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			fail(w, 405, "method not allowed")
			return
		}
		token, err := h.Store.Join(r.Context(), id)
		if err != nil {
			storeError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"playerToken": token, "player": 2})
		return
	}
	if parts[3] != "moves" {
		fail(w, 404, "not found")
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fail(w, 405, "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var req struct {
		Column *int `json:"column"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		fail(w, 400, "invalid JSON body")
		return
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		fail(w, 400, "expected one JSON object")
		return
	}
	if req.Column == nil {
		fail(w, 400, "column is required")
		return
	}
	match, row, err := h.Store.ApplyMove(r.Context(), id, *req.Column, r.Header.Get("X-Player-Token"))
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		state
		Row int `json:"row"`
	}{snapshot(id, match), row})
}
func validID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
func storeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, repository.ErrNotFound):
		fail(w, 404, "game not found")
	case errors.Is(err, repository.ErrAlreadyJoined):
		fail(w, 409, "both player seats are already filled")
	case errors.Is(err, repository.ErrNotOnline):
		fail(w, 409, "this game is not an online match")
	case errors.Is(err, repository.ErrInvalidPlayerToken):
		fail(w, 403, "this browser is not allowed to make that move")
	case errors.Is(err, repository.ErrWaitingForPlayer):
		fail(w, 409, "waiting for the second player to join")
	case errors.Is(err, game.ErrInvalidColumn):
		fail(w, 400, err.Error())
	case errors.Is(err, game.ErrColumnFull), errors.Is(err, game.ErrGameOver):
		fail(w, 409, err.Error())
	default:
		fail(w, 500, "internal server error")
	}
}
