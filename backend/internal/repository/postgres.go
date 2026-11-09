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

func rematchPlayerToken(gameID, rematchID, playerToken string) (string, []byte) {
	value := sha256.Sum256([]byte("connect4-rematch-v1\x00" + gameID + "\x00" + rematchID + "\x00" + playerToken))
	token := base64.RawURLEncoding.EncodeToString(value[:])
	hash := sha256.Sum256([]byte(token))
	return token, hash[:]
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
	var rematchID sql.NullString
	err := p.DB.QueryRowContext(ctx, `SELECT moves, online, red_token_hash, yellow_token_hash, rematch_id FROM games WHERE id=$1`, id).
		Scan(&data, &online, &redTokenHash, &yellowTokenHash, &rematchID)
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
	return &Match{Game: g, Online: online, PlayersJoined: joined, RematchID: rematchID.String}, nil
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

func (p *Postgres) Rematch(ctx context.Context, id, playerToken string) (string, *game.Game, string, int, int, error) {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", nil, "", 0, 0, err
	}
	defer tx.Rollback()

	var data []byte
	var online bool
	var redTokenHash, yellowTokenHash []byte
	var rematchID sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT moves, online, red_token_hash, yellow_token_hash, rematch_id FROM games WHERE id=$1 FOR UPDATE`,
		id).Scan(&data, &online, &redTokenHash, &yellowTokenHash, &rematchID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, "", 0, 0, ErrNotFound
	}
	if err != nil {
		return "", nil, "", 0, 0, err
	}
	if !online {
		return "", nil, "", 0, 0, ErrNotOnline
	}
	providedHash := sha256.Sum256([]byte(playerToken))
	player := 0
	switch {
	case len(redTokenHash) > 0 && subtle.ConstantTimeCompare(providedHash[:], redTokenHash) == 1:
		player = 1
	case len(yellowTokenHash) > 0 && subtle.ConstantTimeCompare(providedHash[:], yellowTokenHash) == 1:
		player = 2
	default:
		return "", nil, "", 0, 0, ErrInvalidPlayerToken
	}
	original, err := replay(data)
	if err != nil {
		return "", nil, "", 0, 0, err
	}
	if original.Status() == game.InProgress {
		return "", nil, "", 0, 0, ErrGameNotFinished
	}

	var newToken string
	var newTokenHash []byte
	if !rematchID.Valid {
		newID, idErr := newID()
		if idErr != nil {
			return "", nil, "", 0, 0, idErr
		}
		newToken, newTokenHash = rematchPlayerToken(id, newID, playerToken)
		if player == 1 {
			_, err = tx.ExecContext(ctx, `INSERT INTO games (id, moves, online, red_token_hash) VALUES ($1, '[]'::jsonb, TRUE, $2)`,
				newID, newTokenHash)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO games (id, moves, online, yellow_token_hash) VALUES ($1, '[]'::jsonb, TRUE, $2)`,
				newID, newTokenHash)
		}
		if err != nil {
			return "", nil, "", 0, 0, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE games SET rematch_id=$2, updated_at=NOW() WHERE id=$1`, id, newID); err != nil {
			return "", nil, "", 0, 0, err
		}
		rematchID = sql.NullString{String: newID, Valid: true}
	} else {
		var rematchMoves []byte
		err = tx.QueryRowContext(ctx, `SELECT moves FROM games WHERE id=$1 FOR UPDATE`, rematchID.String).Scan(&rematchMoves)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil, "", 0, 0, ErrNotFound
		}
		if err != nil {
			return "", nil, "", 0, 0, err
		}
		next, replayErr := replay(rematchMoves)
		if replayErr != nil {
			return "", nil, "", 0, 0, replayErr
		}
		if next.Moves() > 0 {
			return "", nil, "", 0, 0, ErrRematchStarted
		}
		newToken, newTokenHash = rematchPlayerToken(id, rematchID.String, playerToken)
		column := "red_token_hash"
		if player == 2 {
			column = "yellow_token_hash"
		}
		query := fmt.Sprintf(`UPDATE games SET %s=$2, updated_at=NOW() WHERE id=$1`, column)
		if _, err = tx.ExecContext(ctx, query, rematchID.String, newTokenHash); err != nil {
			return "", nil, "", 0, 0, err
		}
	}
	var newRedHash, newYellowHash []byte
	if err = tx.QueryRowContext(ctx, `SELECT red_token_hash, yellow_token_hash FROM games WHERE id=$1`, rematchID.String).
		Scan(&newRedHash, &newYellowHash); err != nil {
		return "", nil, "", 0, 0, err
	}
	joined := 0
	if len(newRedHash) > 0 {
		joined++
	}
	if len(newYellowHash) > 0 {
		joined++
	}
	if err = tx.Commit(); err != nil {
		return "", nil, "", 0, 0, err
	}
	return rematchID.String, game.New(), newToken, player, joined, nil
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
	var rematchID sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT moves, online, red_token_hash, yellow_token_hash, rematch_id FROM games WHERE id=$1 FOR UPDATE`,
		id).Scan(&data, &online, &redTokenHash, &yellowTokenHash, &rematchID)
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
	return &Match{Game: g, Online: online, PlayersJoined: joined, RematchID: rematchID.String}, row, nil
}
