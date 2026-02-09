# Instructions pour Exécuter la Migration PostgreSQL

## Méthode 1 : Depuis votre terminal PostgreSQL actuel

Si vous avez déjà une session PostgreSQL ouverte avec `chainmesh_n8n=>`, exécutez simplement :

```sql
\i /home/astier-flx/projects/chain-mesh/module2-orchestration/migrations/001_initial_schema.sql
```

## Méthode 2 : Depuis la ligne de commande

```bash
PGPASSWORD='StormBringer*564' psql -U chainmesh -d chainmesh_n8n -h localhost -f /home/astier-flx/projects/chain-mesh/module2-orchestration/migrations/001_initial_schema.sql
```

## Méthode 3 : En utilisant sudo (si peer auth activée)

```bash
sudo -u postgres psql -d chainmesh_n8n -f /home/astier-flx/projects/chain-mesh/module2-orchestration/migrations/001_initial_schema.sql
```

## Vérifier que les tables sont créées

Après l'exécution, vérifier :

```sql
-- Lister les tables
\dt

-- Devrait afficher:
-- rate_limits
-- executions
-- circuit_breakers

-- Lister les vues
\dv

-- Devrait afficher:
-- v_recent_executions
-- v_provider_health

-- Vérifier les circuit breakers initiaux
SELECT * FROM circuit_breakers;
```

## Résultat attendu

```
✅ ChainMesh Module 2 - Database schema initialized successfully
   Tables created: rate_limits, executions, circuit_breakers
   Views created: v_recent_executions, v_provider_health
   Circuit breakers initialized: goldsky, alchemy, claude_api
```
