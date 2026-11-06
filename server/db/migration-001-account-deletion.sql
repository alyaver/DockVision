ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_status VARCHAR(20) NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  deletion_job_id UUID PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL,
  step VARCHAR(40) NOT NULL,
  last_error TEXT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_jobs_status
  ON account_deletion_jobs(status);