-- 0001_initial: users, api_keys, key_limits, key_usage, alerts

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_users_email ON users (email);

CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alias VARCHAR(64) NOT NULL,
    label VARCHAR(120) NOT NULL DEFAULT '',
    provider VARCHAR(32) NOT NULL DEFAULT 'openai',
    base_url VARCHAR(255) NOT NULL DEFAULT '',
    secret_ciphertext TEXT NOT NULL,
    secret_last4 VARCHAR(8) NOT NULL DEFAULT '',
    passphrase_hash TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT uq_api_keys_user_alias UNIQUE (user_id, alias)
);
CREATE INDEX ix_api_keys_alias ON api_keys (alias);
CREATE INDEX ix_api_keys_user_id ON api_keys (user_id);

CREATE TABLE key_limits (
    id SERIAL PRIMARY KEY,
    api_key_id INTEGER NOT NULL UNIQUE REFERENCES api_keys(id) ON DELETE CASCADE,
    rate_limit INTEGER NOT NULL DEFAULT 0,
    rate_window_seconds INTEGER NOT NULL DEFAULT 60,
    rate_mode VARCHAR(16) NOT NULL DEFAULT 'block',
    spend_cap_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    spend_mode VARCHAR(16) NOT NULL DEFAULT 'block',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_key_limits_api_key_id ON key_limits (api_key_id);

CREATE TABLE key_usage (
    id BIGSERIAL PRIMARY KEY,
    api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    path VARCHAR(255) NOT NULL DEFAULT '',
    model VARCHAR(120) NOT NULL DEFAULT '',
    status_code INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    is_test BOOLEAN NOT NULL DEFAULT FALSE,
    client_ip VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_key_usage_key_created ON key_usage (api_key_id, created_at);

CREATE TABLE alerts (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
    kind VARCHAR(48) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'warning',
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_alerts_user_created ON alerts (user_id, created_at);
