-- Named coverage comes from local ENC metadata, not preset reference regions.
WITH selected AS MATERIALIZED (
 SELECT r.*,c.bounds,c.metadata,d.source_filename FROM enc.cell_revision r
 JOIN enc.cell c ON c.dataset_id=r.storage_dataset_id AND c.name=r.cell_name
 JOIN enc.dataset d ON d.id=r.storage_dataset_id
 WHERE ($1='' AND EXISTS(SELECT 1 FROM enc.active_cell a WHERE a.revision_id=r.id))
 OR ($1<>'' AND EXISTS(SELECT 1 FROM enc.import_item i JOIN enc.dataset b ON b.id=i.batch_id
 WHERE i.revision_id=r.id AND b.id::text=$1 AND b.state='ready' AND b.deleted_at IS NULL))
), cells AS MATERIALIZED (
 SELECT r.*,ST_CollectionExtract(ST_Difference(COALESCE(m.covered,r.bounds),COALESCE(m.excluded,ST_GeomFromText('POLYGON EMPTY',4326))),3) AS area
 FROM selected r LEFT JOIN LATERAL (
 SELECT ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(f.geometry),3)) FILTER(WHERE f.attributes->>'CATCOV'='1')) AS covered,
 ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(f.geometry),3)) FILTER(WHERE f.attributes->>'CATCOV'='2')) AS excluded
 FROM enc.feature f WHERE f.dataset_id=r.storage_dataset_id AND f.cell_name=r.cell_name AND f.object_class='M_COVR'
 ) m ON true
), areas AS (
 SELECT c.area,jsonb_build_object(
 'name',c.cell_name,'description',COALESCE(NULLIF(c.description,''),c.cell_name),
 'revisionId',c.id,'producer',c.producer,'edition',c.edition,'updateNumber',c.update_number,
 'compilationScale',CASE WHEN c.metadata->>'DSPM_CSCL' ~ '^[0-9]+$' THEN (c.metadata->>'DSPM_CSCL')::bigint ELSE NULL END,
 'sourceFilename',c.source_filename,'metadataSource','CATALOG.031 / DSID',
 'bounds',jsonb_build_array(ST_XMin(c.area),ST_YMin(c.area),ST_XMax(c.area),ST_YMax(c.area))
 ) AS props FROM cells c WHERE c.area IS NOT NULL AND NOT ST_IsEmpty(c.area)
), features AS (
 SELECT jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(area)::jsonb,
 'properties',props || jsonb_build_object('kind','region')) AS feature FROM areas
 UNION ALL
 -- Keep the fill intact and split only its boundary for MapLibre's line mesh.
 SELECT jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(part.geom)::jsonb,
 'properties',props || jsonb_build_object('kind','outline')) FROM areas
 CROSS JOIN LATERAL ST_Subdivide(ST_Boundary(area),6000) AS part(geom)
 UNION ALL
 SELECT jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(ST_PointOnSurface(area))::jsonb,
 'properties',props || jsonb_build_object('kind','label')) FROM areas
)
SELECT jsonb_build_object('type','FeatureCollection','features',COALESCE(jsonb_agg(feature),'[]'::jsonb)) FROM features
