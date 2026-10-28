\connect canonical

-- Reverse member lookups: viewport graph candidates and topology parent queries.
-- Concurrent construction does not block ordinary editing on an existing DB.
CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_current_relation_members_idx
  ON editor.entity_current USING gin (members jsonb_path_ops)
  WHERE visible AND entity_type = 'relation'::editor.entity_type;
