CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  email VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  lock_until TIMESTAMP NULL,
  deletion_status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE sessions (
  session_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE password_reset_tokens (
  password_reset_token_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
CREATE INDEX idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);

-- Track forgot-password request patterns so the backend can rate limit both
-- user-enumeration attempts and repeated reset spam from the same origin.
CREATE TABLE password_reset_request_attempts (
  password_reset_request_attempt_id SERIAL PRIMARY KEY,
  email VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reset_attempts_ip_requested_at ON password_reset_request_attempts (ip_address, requested_at);
CREATE INDEX idx_reset_attempts_email_requested_at ON password_reset_request_attempts (email, requested_at);

CREATE TABLE account_deletion_jobs (
  deletion_job_id UUID PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL,
  step VARCHAR(40) NOT NULL,
  last_error TEXT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL
);

CREATE INDEX idx_account_deletion_jobs_status ON account_deletion_jobs(status);

-- Existing installations should apply server/db/migration-001-account-deletion.sql.
