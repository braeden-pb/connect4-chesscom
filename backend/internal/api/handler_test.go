package api

import (
	"bytes"
	"connect4/internal/game"
	"connect4/internal/repository"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

const testID = "123e4567-e89b-42d3-a456-426614174000"

type memoryStore struct {
	games        map[string]*game.Game
	online       map[string]bool
	redTokens    map[string]string
	yellowTokens map[string]string
}

func TestOnlineMatchJoinAndPlayerAuthorization(t *testing.T) {
	h := Handler{Store: newMemoryStore()}
	created := request(h, http.MethodPost, "/api/games/online", "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create online game: %d %s", created.Code, created.Body.String())
	}
	var red struct {
		ID          string `json:"id"`
		Player      int    `json:"player"`
		PlayerToken string `json:"playerToken"`
		Online      bool   `json:"online"`
		Players     int    `json:"playersJoined"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &red); err != nil {
		t.Fatal(err)
	}
	if red.Player != 1 || red.PlayerToken == "" || !red.Online || red.Players != 1 {
		t.Fatalf("unexpected creator response: %+v", red)
	}

	gamePath := "/api/games/" + red.ID
	stateResponse := request(h, http.MethodGet, gamePath, "")
	var publicState struct {
		Online  bool `json:"online"`
		Players int  `json:"playersJoined"`
	}
	if err := json.Unmarshal(stateResponse.Body.Bytes(), &publicState); err != nil {
		t.Fatal(err)
	}
	if !publicState.Online || publicState.Players != 1 || bytes.Contains(stateResponse.Body.Bytes(), []byte(red.PlayerToken)) {
		t.Fatalf("public state leaked credentials or omitted lobby state: %s", stateResponse.Body.String())
	}

	if w := request(h, http.MethodPost, gamePath+"/moves", `{"column":0}`); w.Code != http.StatusConflict {
		t.Fatalf("unauthenticated move: %d %s", w.Code, w.Body.String())
	}
	if w := requestWithToken(h, http.MethodPost, gamePath+"/moves", `{"column":0}`, red.PlayerToken); w.Code != http.StatusConflict {
		t.Fatalf("move before second player joins: %d %s", w.Code, w.Body.String())
	}

	joined := request(h, http.MethodPost, gamePath+"/join", "")
	if joined.Code != http.StatusOK {
		t.Fatalf("join: %d %s", joined.Code, joined.Body.String())
	}
	var yellow struct {
		Player      int    `json:"player"`
		PlayerToken string `json:"playerToken"`
	}
	if err := json.Unmarshal(joined.Body.Bytes(), &yellow); err != nil {
		t.Fatal(err)
	}
	if yellow.Player != 2 || yellow.PlayerToken == "" || yellow.PlayerToken == red.PlayerToken {
		t.Fatalf("unexpected join response: %+v", yellow)
	}
	if w := request(h, http.MethodPost, gamePath+"/moves", `{"column":0}`); w.Code != http.StatusForbidden {
		t.Fatalf("unauthenticated move after join: %d %s", w.Code, w.Body.String())
	}
	if w := requestWithToken(h, http.MethodPost, gamePath+"/moves", `{"column":0}`, red.PlayerToken); w.Code != http.StatusOK {
		t.Fatalf("red move: %d %s", w.Code, w.Body.String())
	}
	if w := requestWithToken(h, http.MethodPost, gamePath+"/moves", `{"column":1}`, red.PlayerToken); w.Code != http.StatusForbidden {
		t.Fatalf("out-of-turn red move: %d %s", w.Code, w.Body.String())
	}
	if w := requestWithToken(h, http.MethodPost, gamePath+"/moves", `{"column":1}`, yellow.PlayerToken); w.Code != http.StatusOK {
		t.Fatalf("yellow move: %d %s", w.Code, w.Body.String())
	}
	if w := request(h, http.MethodPost, gamePath+"/join", ""); w.Code != http.StatusConflict {
		t.Fatalf("third player join: %d %s", w.Code, w.Body.String())
	}
}

func (m *memoryStore) Create(_ context.Context) (string, *game.Game, error) {
	g := game.New()
	m.games[testID] = g
	return testID, g, nil
}
func requestWithToken(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	r.Header.Set("X-Player-Token", token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func (m *memoryStore) CreateOnline(_ context.Context) (string, *game.Game, string, error) {
	g := game.New()
	m.games[testID] = g
	m.online[testID] = true
	m.redTokens[testID] = "red-secret"
	return testID, g, "red-secret", nil
}
func (m *memoryStore) Get(_ context.Context, id string) (*repository.Match, error) {
	g, ok := m.games[id]
	if !ok {
		return nil, repository.ErrNotFound
	}
	joined := 2
	if m.online[id] {
		joined = 0
		if m.redTokens[id] != "" {
			joined++
		}
		if m.yellowTokens[id] != "" {
			joined++
		}
	}
	return &repository.Match{Game: g, Online: m.online[id], PlayersJoined: joined}, nil
}
func (m *memoryStore) Join(_ context.Context, id string) (string, error) {
	if _, ok := m.games[id]; !ok {
		return "", repository.ErrNotFound
	}
	if !m.online[id] {
		return "", repository.ErrNotOnline
	}
	if m.yellowTokens[id] != "" {
		return "", repository.ErrAlreadyJoined
	}
	m.yellowTokens[id] = "yellow-secret"
	return "yellow-secret", nil
}
func (m *memoryStore) ApplyMove(_ context.Context, id string, c int, token string) (*repository.Match, int, error) {
	match, err := m.Get(context.Background(), id)
	if err != nil {
		return nil, -1, err
	}
	if match.Online {
		if match.PlayersJoined < 2 {
			return nil, -1, repository.ErrWaitingForPlayer
		}
		expected := m.redTokens[id]
		if match.Game.Turn() == game.Yellow {
			expected = m.yellowTokens[id]
		}
		if token != expected || expected == "" {
			return nil, -1, repository.ErrInvalidPlayerToken
		}
	} else if token != "" {
		return nil, -1, repository.ErrNotOnline
	}
	row, err := match.Game.Drop(c)
	return match, row, err
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		games: map[string]*game.Game{}, online: map[string]bool{},
		redTokens: map[string]string{}, yellowTokens: map[string]string{},
	}
}
func request(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestLifecycle(t *testing.T) {
	h := Handler{Store: newMemoryStore()}
	w := request(h, "POST", "/api/games", "")
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Location") != "/api/games/"+testID {
		t.Fatal("missing location")
	}
	w = request(h, "GET", "/api/games/"+testID, "")
	if w.Code != 200 {
		t.Fatalf("get: %d", w.Code)
	}
	w = request(h, "POST", "/api/games/"+testID+"/moves", `{"column":3}`)
	if w.Code != 200 {
		t.Fatalf("move: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Row     int       `json:"row"`
		Moves   int       `json:"moves"`
		Turn    int       `json:"turn"`
		Board   [6][7]int `json:"board"`
		History []int     `json:"history"`
		Online  bool      `json:"online"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Row != 5 || result.Moves != 1 || result.Turn != 2 || result.Board[5][3] != 1 || !slices.Equal(result.History, []int{3}) {
		t.Fatalf("wrong state: %+v", result)
	}
	w = request(h, "GET", "/api/games/"+testID, "")
	if !bytes.Contains(w.Body.Bytes(), []byte(`"moves":1`)) {
		t.Fatal("move not persisted in store")
	}
}
func TestErrors(t *testing.T) {
	h := Handler{Store: newMemoryStore()}
	h.Store.(*memoryStore).games[testID] = game.New()
	cases := []struct {
		method, path, body string
		code               int
	}{
		{"GET", "/api/games", "", 405},
		{"GET", "/api/games/not-an-id", "", 404},
		{"GET", "/api/games/" + "00000000-0000-4000-8000-000000000000", "", 404},
		{"POST", "/api/games/" + testID + "/moves", `{}`, 400},
		{"POST", "/api/games/" + testID + "/moves", `{"column":7}`, 400},
		{"POST", "/api/games/" + testID + "/moves", `{"column":1} {}`, 400},
		{"POST", "/api/games/" + testID + "/moves", `{"column":"1"}`, 400},
		{"POST", "/api/games/" + testID + "/moves", `{"column":1,"other":2}`, 400},
		{"PUT", "/api/games/" + testID + "/moves", "", 405},
		{"GET", "/api/games/" + testID + "/moves", "", 405},
	}
	for _, tc := range cases {
		w := request(h, tc.method, tc.path, tc.body)
		if w.Code != tc.code {
			t.Errorf("%s %s (%s): got %d want %d", tc.method, tc.path, tc.body, w.Code, tc.code)
		}
	}
	for i := 0; i < 6; i++ {
		w := request(h, "POST", "/api/games/"+testID+"/moves", `{"column":0}`)
		if w.Code != 200 {
			t.Fatalf("fill move %d: %s", i, w.Body.String())
		}
	}
	if w := request(h, "POST", "/api/games/"+testID+"/moves", `{"column":0}`); w.Code != 409 {
		t.Fatalf("full column: %d", w.Code)
	}
}
func TestGameOverConflict(t *testing.T) {
	h := Handler{Store: newMemoryStore()}
	h.Store.(*memoryStore).games[testID] = game.New()
	for _, c := range []int{0, 1, 0, 1, 0, 1, 0} {
		w := request(h, "POST", "/api/games/"+testID+"/moves", `{"column":`+string(rune('0'+c))+`}`)
		if w.Code != 200 {
			t.Fatalf("move: %s", w.Body.String())
		}
	}
	if w := request(h, "POST", "/api/games/"+testID+"/moves", `{"column":2}`); w.Code != 409 {
		t.Fatalf("game over: %d", w.Code)
	}
}

var _ = errors.Is

// TestCompleteMatchOverHTTP exercises the public HTTP contract from creation
// through a win, including the final persisted state and post-game rejection.
func TestCompleteMatchOverHTTP(t *testing.T) {
	h := Handler{Store: newMemoryStore()}
	created := request(h, http.MethodPost, "/api/games", "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d", created.Code)
	}
	path := created.Header().Get("Location")
	for i, col := range []int{0, 0, 1, 1, 2, 2, 3} {
		w := request(h, http.MethodPost, path+"/moves", fmt.Sprintf(`{"column":%d}`, col))
		if w.Code != http.StatusOK {
			t.Fatalf("move %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	w := request(h, http.MethodGet, path, "")
	var state struct {
		Status  string    `json:"status"`
		Winner  int       `json:"winner"`
		Moves   int       `json:"moves"`
		Board   [6][7]int `json:"board"`
		History []int     `json:"history"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if state.Status != "won" || state.Winner != 1 || state.Moves != 7 || !slices.Equal(state.History, []int{0, 0, 1, 1, 2, 2, 3}) {
		t.Fatalf("final state: %+v", state)
	}
	for col := 0; col < 4; col++ {
		if state.Board[5][col] != 1 {
			t.Fatalf("missing winning disc at column %d", col)
		}
	}
	rejected := request(h, http.MethodPost, path+"/moves", `{"column":4}`)
	if rejected.Code != http.StatusConflict {
		t.Fatalf("post-game move: %d", rejected.Code)
	}
}
