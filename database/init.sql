CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY,
    moves JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT moves_is_array CHECK (jsonb_typeof(moves) = 'array')
);
