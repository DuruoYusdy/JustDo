BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE public."LiteLLM_EndUserTable" ADD COLUMN IF NOT EXISTS metadata jsonb;
COMMIT;
