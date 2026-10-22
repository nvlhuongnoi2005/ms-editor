-- Graph viewport reads are bounded by an envelope and use KNN ordering.
-- The global GiST index is retained for all entity geometry; partial GiST
-- indexes reduce index size and heap work for the two hot editor queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_current_visible_way_bbox_idx
  ON editor.entity_current USING gist (bbox)
  WHERE visible AND entity_type = 'way'::editor.entity_type;

CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_current_visible_node_bbox_idx
  ON editor.entity_current USING gist (bbox)
  WHERE visible AND entity_type = 'node'::editor.entity_type;
