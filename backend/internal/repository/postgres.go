package repository

import (
	"connect4/internal/game"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
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
	_, err = p.DB.ExecContext(ctx, `INSERT INTO games (id, moves, online) VALUES ($1, '[]'::jsonb, FALSE)`, id)
	if err != nil {
		return "", nil, err
	}
	return id, game.New(), nil
}

func newPlayerToken() (string, []byte, error) {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return "", nil, err
	}
	value := base64.RawURLEncoding.EncodeToString(token)
	hash := sha256.Sum256([]byte(value))
	return value, hash[:], nil
}

func (p *Postgres) CreateOnline(ctx context.Context) (string, *game.Game, string, error) {
	id, err := newID()
	if err != nil {
		return "", nil, "", err
	}
	token, tokenHash, err := newPlayerToken()
	if err != nil {
		return "", nil, "", err
	}
	if _, err = p.DB.ExecContext(ctx, `INSERT INTO games (id, moves, online, red_token_hash) VALUES ($1, '[]'::jsonb, TRUE, $2)`, id, tokenHash); err != nil {
		return "", nil, "", err
	}
	return id, game.New(), token, nil
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

func (p *Postgres) Get(ctx context.Context, id string) (*Match, error) {
	var data []byte
	var online bool
	var redTokenHash, yellowTokenHash []byte
	err := p.DB.QueryRowContext(ctx, `SELECT moves, online, red_token_hash, yellow_token_hash FROM games WHERE id=$1`, id).Scan(&data, &online, &redTokenHash, &yellowTokenHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	g, err := replay(data)
	if err != nil {
		return nil, err
	}
	joined := 0
	if !online {
		joined = 2
	} else {
		if len(redTokenHash) > 0 {
			joined++
		}
		if len(yellowTokenHash) > 0 {
			joined++
		}
	}
	return &Match{Game: g, Online: online, PlayersJoined: joined}, nil
}

func (p *Postgres) Join(ctx context.Context, id string) (string, error) {
	token, tokenHash, err := newPlayerToken()
	if err != nil {
		return "", err
	}
	result, err := p.DB.ExecContext(ctx, `UPDATE games SET yellow_token_hash=$2 WHERE id=$1 AND online=TRUE AND yellow_token_hash IS NULL`, id, tokenHash)
	if err != nil {
		return "", err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if count == 0 {
		match, getErr := p.Get(ctx, id)
		if getErr != nil {
			return "", getErr
		}
		if !match.Online {
			return "", ErrNotOnline
		}
		return "", ErrAlreadyJoined
	}
	return token, nil
}

func (p *Postgres) ApplyMove(ctx context.Context, id string, column int, token string) (_ *Match, _ int, err error) {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, -1, err
	}
	defer tx.Rollback()
	var data []byte
	var online bool
	var redTokenHash, yellowTokenHash []byte
	err = tx.QueryRowContext(ctx, `SELECT moves, online, red_token_hash, yellow_token_hash FROM games WHERE id=$1 FOR UPDATE`, id).Scan(&data, &online, &redTokenHash, &yellowTokenHash)
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
	if online {
		if len(redTokenHash) == 0 || len(yellowTokenHash) == 0 {
			return nil, -1, ErrWaitingForPlayer
		}
		providedHash := sha256.Sum256([]byte(token))
		expectedHash := redTokenHash
		if g.Turn() == game.Yellow {
			expectedHash = yellowTokenHash
		}
		if len(expectedHash) == 0 || subtle.ConstantTimeCompare(providedHash[:], expectedHash) != 1 {
			return nil, -1, ErrInvalidPlayerToken
		}
	} else if token != "" {
		return nil, -1, ErrNotOnline
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
	joined := 0
	if !online {
		joined = 2
	} else {
		if len(redTokenHash) > 0 {
			joined++
		}
		if len(yellowTokenHash) > 0 {
			joined++
		}
	}
	return &Match{Game: g, Online: online, PlayersJoined: joined}, row, nil
}
