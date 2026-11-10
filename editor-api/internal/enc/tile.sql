-- Compilation scales and SCAMIN use a zoom-based display denominator.
-- This is a viewer selection profile, not a complete S-52 portrayal engine.
WITH tile AS (
 SELECT ST_TileEnvelope($1,$2,$3) AS box, 559082264.028 / power(2.0,$1) AS scale
), viewport AS (
 SELECT *, ST_Transform(ST_Expand(box,(ST_XMax(box)-ST_XMin(box))*128/4096),4326) AS area FROM tile
), candidates AS MATERIALIZED (
 SELECT c.*, CASE WHEN c.metadata->>'DSPM_CSCL' ~ '^[0-9]+$'
   THEN NULLIF((c.metadata->>'DSPM_CSCL')::double precision,0) END AS compilation_scale
 FROM enc.cell c JOIN enc.dataset d ON d.id=c.dataset_id CROSS JOIN viewport v
 WHERE d.id::text=$4 AND d.state='ready' AND ($5='' OR c.name=$5) AND c.bounds && v.area
), coverage AS MATERIALIZED (
 SELECT c.dataset_id,c.name,c.compilation_scale,
 ST_Intersection(v.area,COALESCE(
   ST_Difference(m.covered,COALESCE(m.excluded,ST_GeomFromText('POLYGON EMPTY',4326))),c.bounds)) AS area
 FROM candidates c CROSS JOIN viewport v
 LEFT JOIN LATERAL (
  SELECT ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(f.geometry),3)) FILTER (WHERE f.attributes->>'CATCOV'='1')) AS covered,
         ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(f.geometry),3)) FILTER (WHERE f.attributes->>'CATCOV'='2')) AS excluded
  FROM enc.feature f WHERE f.dataset_id=c.dataset_id AND f.cell_name=c.name AND f.object_class='M_COVR'
 ) m ON true
 WHERE $1<9 OR $5<>'' OR c.compilation_scale IS NULL OR c.compilation_scale >= v.scale/8
), ranked AS (
 SELECT *, ST_Union(area) OVER (ORDER BY compilation_scale ASC NULLS LAST,name
  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous FROM coverage
), masks AS MATERIALIZED (
 SELECT *, CASE WHEN previous IS NULL THEN area ELSE ST_Difference(area,previous) END AS visible FROM ranked
), features AS (
 SELECT f.cell_name||':'||f.object_class||':'||f.source_id AS feature_id,
 f.cell_name,f.object_class,f.attributes,
 COALESCE(f.attributes->'COLOUR'->>0,f.attributes->>'COLOUR','') AS colour_code,
 ST_AsMVTGeom(ST_Transform(ST_CollectionExtract(
   CASE WHEN ST_CoveredBy(f.geometry,m.visible) THEN f.geometry
        ELSE ST_Intersection(ST_MakeValid(f.geometry),m.visible) END,
   ST_Dimension(f.geometry)+1),3857),v.box,4096,128,true) AS geom
 FROM masks m JOIN enc.feature f ON f.dataset_id=m.dataset_id AND f.cell_name=m.name CROSS JOIN viewport v
 WHERE $1>=9 AND NOT ST_IsEmpty(m.visible) AND f.geometry && m.visible
 AND f.object_class NOT IN ('IsolatedNode','ConnectedNode','Edge','Face')
 AND f.object_class NOT LIKE 'M\_%' ESCAPE '\'
 AND ($5<>'' OR CASE WHEN f.attributes->>'SCAMIN' ~ '^[0-9]+$'
       THEN (f.attributes->>'SCAMIN')::double precision IN (0) OR (f.attributes->>'SCAMIN')::double precision >= v.scale
       ELSE true END)
), overview AS (
 SELECT c.name AS cell_name,
 ST_AsMVTGeom(ST_Transform(c.bounds,3857),v.box,4096,128,true) AS geom
 FROM candidates c CROSS JOIN viewport v WHERE $1<9
), overview_areas AS (
 SELECT c.name AS cell_name,
 ST_AsMVTGeom(ST_Transform(c.area,3857),v.box,4096,128,true) AS geom
 FROM coverage c CROSS JOIN viewport v WHERE $1<9
)
SELECT (SELECT COALESCE(ST_AsMVT(features,'enc',4096,'geom'),''::bytea) FROM features)
 || (SELECT COALESCE(ST_AsMVT(overview,'coverage',4096,'geom'),''::bytea) FROM overview)
 || (SELECT COALESCE(ST_AsMVT(overview_areas,'coverage_areas',4096,'geom'),''::bytea) FROM overview_areas)
