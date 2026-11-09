package repository

import (
	"connect4/internal/game"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

type Postgres struct{ DB *sql.DB }

func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[:8], h[8:12], h[12:16], h[16:20], h[20:]), nil
}

func (p *Postgres) Create(ctx context.Context) (string, *game.Game, error) {
	id, err := newID()
	if err != nil {
		return "", nil, err
	}
	_, err = p.DB.ExecContext(ctx, `INSERT INTO games (id, moves) VALUES ($1, '[]'::jsonb)`, id)
	if err != nil {
		return "", nil, err
	}
	return id, game.New(), nil
}

func replay(data []byte) (*game.Game, error) {
	var columns []int
	if err := json.Unmarshal(data, &columns); err != nil {
		return nil, fmt.Errorf("decode stored moves: %w", err)
	}
	if columns == nil {
		return nil, errors.New("stored moves must be a JSON array")
	}
	g := game.New()
	for _, c := range columns {
		if _, err := g.Drop(c); err != nil {
			return nil, fmt.Errorf("invalid stored game: %w", err)
		}
	}
	return g, nil
}

func (p *Postgres) Get(ctx context.Context, id string) (*game.Game, error) {
	var data []byte
	err := p.DB.QueryRowContext(ctx, `SELECT moves FROM games WHERE id=$1`, id).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return replay(data)
}

func (p *Postgres) ApplyMove(ctx context.Context, id string, column int) (_ *game.Game, _ int, err error) {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, -1, err
	}
	defer tx.Rollback()
	var data []byte
	err = tx.QueryRowContext(ctx, `SELECT moves FROM games WHERE id=$1 FOR UPDATE`, id).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, -1, ErrNotFound
	}
	if err != nil {
		return nil, -1, err
	}
	g, err := replay(data)
	if err != nil {
		return nil, -1, err
	}
	row, err := g.Drop(column)
	if err != nil {
		return nil, -1, err
	}
	var columns []int
	if err = json.Unmarshal(data, &columns); err != nil {
		return nil, -1, err
	}
	columns = append(columns, column)
	updated, err := json.Marshal(columns)
	if err != nil {
		return nil, -1, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE games SET moves=$2::jsonb, updated_at=NOW() WHERE id=$1`, id, string(updated)); err != nil {
		return nil, -1, err
	}
	if err = tx.Commit(); err != nil {
		return nil, -1, err
	}
	return g, row, nil
}
