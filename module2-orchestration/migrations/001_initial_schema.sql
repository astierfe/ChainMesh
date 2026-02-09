-- ChainMesh Module 2 - Initial Database Schema
-- Date: 2026-02-09
-- Description: Tables pour rate limiting, traçabilité et circuit breakers

-- Table pour rate limiting
-- Stocke les timestamps des dernières requêtes par clé (key)
CREATE TABLE IF NOT EXISTS rate_limits (
  key BYTEA PRIMARY KEY,
  last_request_time BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE rate_limits IS 'Gestion du rate limiting par clé (bytes32)';
COMMENT ON COLUMN rate_limits.key IS 'Clé unique (bytes32 depuis blockchain)';
COMMENT ON COLUMN rate_limits.last_request_time IS 'Timestamp Unix de la dernière requête';

-- Table pour traçabilité des exécutions
-- Permet de suivre toutes les exécutions de workflows et API calls
CREATE TABLE IF NOT EXISTS executions (
  execution_id VARCHAR(64) PRIMARY KEY,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout')),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  error_message TEXT,
  metadata JSONB
);

COMMENT ON TABLE executions IS 'Traçabilité de toutes les exécutions';
COMMENT ON COLUMN executions.execution_id IS 'ID unique généré (UUID ou custom)';
COMMENT ON COLUMN executions.status IS 'État de l''exécution: pending, running, success, failed, timeout';
COMMENT ON COLUMN executions.metadata IS 'Données supplémentaires (schemaHash, provider, etc.)';

-- Table pour circuit breakers
-- Gestion de l'état des providers (OPEN/CLOSED/HALF_OPEN)
CREATE TABLE IF NOT EXISTS circuit_breakers (
  provider VARCHAR(50) PRIMARY KEY,
  state VARCHAR(20) NOT NULL CHECK (state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  failure_count INT DEFAULT 0,
  last_failure_time TIMESTAMP,
  last_success_time TIMESTAMP
);

COMMENT ON TABLE circuit_breakers IS 'État des circuit breakers par provider';
COMMENT ON COLUMN circuit_breakers.provider IS 'Nom du provider (goldsky, alchemy, etc.)';
COMMENT ON COLUMN circuit_breakers.state IS 'État: CLOSED (ok), OPEN (fail), HALF_OPEN (recovery)';
COMMENT ON COLUMN circuit_breakers.failure_count IS 'Nombre d''échecs consécutifs';

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_start_time ON executions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_circuit_breakers_state ON circuit_breakers(state);

-- Initialiser les circuit breakers pour les providers connus
INSERT INTO circuit_breakers (provider, state, failure_count)
VALUES
  ('goldsky', 'CLOSED', 0),
  ('alchemy', 'CLOSED', 0),
  ('claude_api', 'CLOSED', 0)
ON CONFLICT (provider) DO NOTHING;

-- Vues utiles pour le monitoring
CREATE OR REPLACE VIEW v_recent_executions AS
SELECT
  execution_id,
  status,
  start_time,
  end_time,
  EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time)) AS duration_seconds,
  metadata->>'schemaHash' AS schema_hash,
  metadata->>'provider' AS provider
FROM executions
WHERE start_time > NOW() - INTERVAL '24 hours'
ORDER BY start_time DESC;

COMMENT ON VIEW v_recent_executions IS 'Exécutions des dernières 24h avec durée calculée';

CREATE OR REPLACE VIEW v_provider_health AS
SELECT
  provider,
  state,
  failure_count,
  last_failure_time,
  last_success_time,
  EXTRACT(EPOCH FROM (NOW() - COALESCE(last_failure_time, NOW() - INTERVAL '1 year'))) AS seconds_since_last_failure
FROM circuit_breakers
ORDER BY state DESC, failure_count DESC;

COMMENT ON VIEW v_provider_health IS 'Santé des providers en temps réel';

-- Afficher un résumé de l'installation
DO $$
BEGIN
  RAISE NOTICE '✅ ChainMesh Module 2 - Database schema initialized successfully';
  RAISE NOTICE '   Tables created: rate_limits, executions, circuit_breakers';
  RAISE NOTICE '   Views created: v_recent_executions, v_provider_health';
  RAISE NOTICE '   Circuit breakers initialized: goldsky, alchemy, claude_api';
END $$;
