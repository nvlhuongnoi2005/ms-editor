-- Cell selection uses a fixed zoom denominator so neighboring tiles select
-- the same cells at their shared boundary. SCAMIN retains local ground scale.
-- This is a viewer selection profile, not a complete S-52 portrayal engine.
WITH tile AS (
 SELECT ST_TileEnvelope($1,$2,$3) AS box,
 279541132.014 / power(2.0,$1) AS selection_scale,
 279541132.014 * cos(atan(sinh(pi() * (1 - 2 * (($3 + 0.5) / power(2.0,$1)))))) / power(2.0,$1) AS scale
), viewport AS (
 SELECT *, ST_Transform(ST_Expand(box,(ST_XMax(box)-ST_XMin(box))*128/4096),4326) AS area FROM tile
), candidates AS MATERIALIZED (
 SELECT c.*, r.id AS revision_id, r.producer, CASE WHEN c.metadata->>'DSPM_CSCL' ~ '^[0-9]+$'
   THEN NULLIF((c.metadata->>'DSPM_CSCL')::double precision,0) END AS compilation_scale,
 CASE WHEN c.metadata->>'DSID_INTU' ~ '^[1-6]$'
   THEN (c.metadata->>'DSID_INTU')::integer END AS intended_usage,
 r.edition AS revision_edition,r.update_number AS revision_update
 FROM enc.cell_revision r JOIN enc.cell c ON c.dataset_id=r.storage_dataset_id AND c.name=r.cell_name CROSS JOIN viewport v
 WHERE (
   ($8<>'' AND r.id=$8)
   OR ($8='' AND (
     ($4='' AND EXISTS(SELECT 1 FROM enc.active_cell a WHERE a.revision_id=r.id))
     OR ($4<>'' AND EXISTS(SELECT 1 FROM enc.import_item i JOIN enc.dataset d ON d.id=i.batch_id WHERE i.revision_id=r.id AND d.id::text=$4 AND d.state='ready' AND d.deleted_at IS NULL))
   ))
 )
 AND ($5='' OR c.name=$5) AND c.bounds && v.area
), coverage AS MATERIALIZED (
 SELECT c.dataset_id,c.name,c.revision_id,c.producer,c.compilation_scale,c.intended_usage,
 c.revision_edition,c.revision_update,
 -- Allow a twofold reduction of compilation scale before preferring a coarser
 -- chart. Keep other cells as fallback for uncovered areas; never drop them.
 CASE WHEN $5<>'' OR c.compilation_scale >= v.selection_scale/2 THEN 0
      WHEN c.compilation_scale IS NOT NULL THEN 1 ELSE 2 END AS selection_priority,
 ST_CollectionExtract(ST_Intersection(v.area,
   ST_Difference(COALESCE(m.covered,c.bounds),
     COALESCE(m.excluded,ST_GeomFromText('POLYGON EMPTY',4326)))),3) AS area
 FROM candidates c CROSS JOIN viewport v
 LEFT JOIN LATERAL (
  SELECT ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(f.geometry),3)) FILTER (WHERE f.attributes->>'CATCOV'='1')) AS covered,
         ST_UnaryUnion(ST_Collect(ST_CollectionExtract(ST_MakeValid(f.geometry),3)) FILTER (WHERE f.attributes->>'CATCOV'='2')) AS excluded
  FROM enc.feature f WHERE f.dataset_id=c.dataset_id AND f.cell_name=c.name AND f.object_class='M_COVR'
 ) m ON true
), ranked AS (
 -- Suitable cells: finest first. If all cells are too detailed, use the
 -- coarsest available first, and let finer cells fill remaining holes only.
 -- INTU breaks equal-scale ties; edition/update resolves batch revision ties.
 SELECT *, ST_Union(area) OVER (ORDER BY selection_priority,
  CASE WHEN selection_priority=0 THEN compilation_scale END ASC NULLS LAST,
  CASE WHEN selection_priority=1 THEN compilation_scale END DESC NULLS LAST,
  intended_usage DESC NULLS LAST,producer,name,revision_edition DESC,revision_update DESC,revision_id
  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous FROM coverage
), masks AS MATERIALIZED (
 SELECT *, CASE WHEN previous IS NULL THEN area ELSE ST_Difference(area,previous) END AS visible FROM ranked
), display_profile AS (
 SELECT *, CASE WHEN $1<11 THEN 64 WHEN $1<14 THEN 32 ELSE 16 END AS sounding_spacing
 FROM viewport
), cell_safety AS MATERIALIZED (
 -- Use the configured contour; if it is absent, use the next deeper chart contour.
 -- Keep this cell-wide so the effective contour does not change at tile edges.
 SELECT c.dataset_id,c.name,min((f.attributes->>'VALDCO')::double precision) AS contour
 FROM candidates c JOIN enc.feature f ON f.dataset_id=c.dataset_id AND f.cell_name=c.name
 WHERE f.object_class='DEPCNT' AND CASE WHEN jsonb_typeof(f.attributes->'VALDCO')='number'
 THEN (f.attributes->>'VALDCO')::double precision>=$6::double precision ELSE false END
 GROUP BY c.dataset_id,c.name
), position_quality AS MATERIALIZED (
 -- QUAPOS is a spatial attribute in S-57; GDAL keeps it on the linked primitive,
 -- not necessarily on the feature. Build one small lookup per original cell.
 SELECT s.dataset_id,s.cell_name,
 jsonb_object_agg((s.attributes->>'RCNM')||':'||(s.attributes->>'RCID'),s.attributes->'QUAPOS') AS records
 FROM enc.spatial_record s JOIN candidates c ON c.dataset_id=s.dataset_id AND c.name=s.cell_name
 WHERE s.attributes->>'QUAPOS' IN ('2','3','4','5','6','7','8','9')
 GROUP BY s.dataset_id,s.cell_name
), raw_features AS (
 SELECT m.revision_id::text||':'||f.cell_name||':'||f.object_class||':'||f.source_id AS feature_id,
 f.cell_name,f.object_class,
 f.attributes || COALESCE(normalized.properties,'{}'::jsonb) ||
 jsonb_build_object('edit_key',f.object_class||'/'||f.source_id,'s52_geometry',ST_Dimension(f.geometry),
   's52_quapos',COALESCE(f.attributes->>'QUAPOS',linked_quality.quapos),
    's52_surrounding_depth',depth_context.deepest_lower_bound,
    's52_safety_contour',COALESCE(safety.contour,$6::double precision),
    's52_safety_depth',$7::double precision,
    -- Class-level viewer profile: the supplied Symbol Catalogue describes
    -- symbols and measurements, while the full S-52 lookup/CSP tables are not
    -- part of this repo. Unlisted classes stay available under OTHER.
    's52_display_category',CASE
      WHEN f.object_class IN ('DEPARE','DRGARE','LNDARE','COALNE','DEPCNT') THEN 'BASE'
      WHEN f.object_class IN (
        'ACHARE','ACHBRT','ADMARE','AIRARE','BCNLAT','BCNSPP','BERTHS','BOYCAR','BOYLAT','BOYSAW','BOYSPP',
        'BRIDGE','BUAARE','BUISGL','CANALS','CBLARE','CBLOHD','CBLSUB','CGUSTA','CONVYR','CONZNE','COSARE',
        'CRANES','CTNARE','CTSARE','CURENT','DAMCON','DAYMAR','DISMAR','DMPGRD','DRYDOC','DYKCON','EXEZNE',
        'FAIRWY','FERYRT','FLODOC','FNCLNE','FOGSIG','FORSTC','FSHFAC','FSHGRD','FSHZNE','GATCON','HRBFAC',
        'HULKES','ICEARE','LAKARE','LIGHTS','LNDELV','LNDRGN','LNDMRK','LOCMAG','MAGVAR','MARCUL','MIPARE',
        'MORFAC','NAVLNE','NEWOBJ','OBSTRN','OFSPLF','OSPARE','PILBOP','PILPNT','PIPARE','PIPOHD','PIPSOL',
        'PONTON','PRCARE','PRDARE','PYLONS','RAPIDS','RDOCAL','RDOSTA','RECTRC','RESARE','RETRFL','RIVERS',
        'ROADWY','RTPBCN','RUNWAY','SBDARE','SEAARE','SILTNK','SISTAW','SLCONS','SLOGRD','SLOTOP','SMCFAC',
        'SNDWAV','SOUNDG','TESARE','TOPMAR','TSEZNE','TSSBND','TSSLPT','TIDSTR','TIDEHT','WATTUR','WEDKLP'
      ) THEN 'STANDARD'
      ELSE 'OTHER' END) ||
 CASE WHEN f.object_class='TOPMAR' THEN jsonb_build_object('topmark_floating',EXISTS(
   SELECT 1 FROM enc.feature platform WHERE platform.dataset_id=f.dataset_id AND platform.cell_name=f.cell_name
   AND platform.object_class IN ('BOYLAT','BOYCAR','BOYISD','BOYSAW','BOYSPP','BOYINB','LITFLT','LITVES')
   AND platform.geometry && f.geometry AND ST_Equals(platform.geometry,f.geometry)
 )) ELSE '{}'::jsonb END AS attributes,
 m.revision_id::text AS revision_id,m.producer,
 m.compilation_scale,m.intended_usage,
 CASE m.selection_priority WHEN 0 THEN 'scale_match' WHEN 1 THEN 'coverage_fallback' ELSE 'unknown_scale' END AS cell_selection,
 -- Power-of-two spacing aligns the world grid with tile boundaries.
 CASE WHEN f.object_class='SOUNDG' AND $1<17 THEN floor(ST_X(ST_Transform(f.geometry,3857))/((ST_XMax(v.box)-ST_XMin(v.box))/512 * v.sounding_spacing)) END AS density_x,
 CASE WHEN f.object_class='SOUNDG' AND $1<17 THEN floor(ST_Y(ST_Transform(f.geometry,3857))/((ST_XMax(v.box)-ST_XMin(v.box))/512 * v.sounding_spacing)) END AS density_y,
 COALESCE(f.attributes->'COLOUR'->>0,f.attributes->>'COLOUR','') AS colour_code,
 -- Anchor from the original feature, never a per-tile clipped fragment.
 -- Coverage ownership then decides which cell may emit the anchor.
 CASE WHEN ST_Dimension(f.geometry)>0 AND ST_CoveredBy(ST_PointOnSurface(f.geometry),m.visible)
 THEN ST_AsMVTGeom(ST_Transform(ST_PointOnSurface(f.geometry),3857),v.box,4096,128,true) END AS symbol_geom,
 ST_AsMVTGeom(ST_Transform(ST_CollectionExtract(
   CASE WHEN ST_CoveredBy(f.geometry,m.visible) THEN f.geometry
        ELSE ST_Intersection(ST_MakeValid(f.geometry),m.visible) END,
   ST_Dimension(f.geometry)+1),3857),v.box,4096,128,true) AS geom
 FROM masks m JOIN enc.feature f ON f.dataset_id=m.dataset_id AND f.cell_name=m.name CROSS JOIN display_profile v
 LEFT JOIN cell_safety safety ON safety.dataset_id=f.dataset_id AND safety.name=f.cell_name
 LEFT JOIN position_quality q ON q.dataset_id=f.dataset_id AND q.cell_name=f.cell_name
 LEFT JOIN LATERAL (
   SELECT max(q.records->>((f.attributes->'NAME_RCNM'->>(refs.ordinal-1)::integer)||':'||refs.rcid)) AS quapos
   FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.attributes->'NAME_RCID')='array'
     THEN f.attributes->'NAME_RCID' ELSE '[]'::jsonb END) WITH ORDINALITY AS refs(rcid,ordinal)
 ) linked_quality ON true
 LEFT JOIN LATERAL (
   -- Evaluate against original geometry, before clipping/density filtering. The
   -- context must come from the same source cell, never another edition/upload.
   SELECT max((d.attributes->>'DRVAL1')::double precision) FILTER (
     WHERE jsonb_typeof(d.attributes->'DRVAL1')='number') AS deepest_lower_bound
   FROM enc.feature d
   WHERE f.object_class IN ('WRECKS','UWTROC','OBSTRN')
   AND d.dataset_id=f.dataset_id AND d.cell_name=f.cell_name
   AND d.object_class IN ('DEPARE','DRGARE') AND ST_Dimension(d.geometry)=2
   AND d.geometry && f.geometry AND ST_Intersects(ST_MakeValid(d.geometry),f.geometry)
 ) depth_context ON true
 LEFT JOIN LATERAL (
   SELECT jsonb_object_agg('sym_'||key,CASE WHEN jsonb_typeof(value)='array' THEN value->0 ELSE value END)
     || jsonb_object_agg('list_'||key,'|'||CASE WHEN jsonb_typeof(value)='array'
       THEN (SELECT string_agg(item,'|' ORDER BY ordinal) FROM jsonb_array_elements_text(value) WITH ORDINALITY AS a(item,ordinal))
       ELSE trim(both '"' from value::text) END||'|') AS properties
   FROM jsonb_each(f.attributes)
   WHERE key IN ('COLOUR','CATCAM','CATLAM','CATSPM','BOYSHP','BCNSHP','CONVIS','CATLMK','FUNCTN',
     'TOPSHP','CATWRK','WATLEV','CATOBS','CATSIL','CATMOR','CATFIF','CATGAT','CATROS','CATTRK',
     'TRAFIC','RESTRN','CATVEG','QUASOU','QUAPOS','NATSUR','NATQUA','CATREA','CATPRA','CATLND','CONRAD',
     'CATLIT','LITVIS','CATHAF','CATCHP','CATSLO','CATBRG','CATSCF','CAT_TS',
     'CATSLC','CONDTN','CATCBL','CATPIP','PRODCT','CATCON','CATDAM','STATUS')
 ) normalized ON true
 WHERE $1>=9 AND NOT ST_IsEmpty(m.visible) AND f.geometry && m.visible
 AND f.object_class NOT IN ('IsolatedNode','ConnectedNode','Edge','Face')
 AND f.object_class NOT LIKE 'M\_%' ESCAPE '\'
 -- Missing or malformed depths are not zero-depth soundings. Keep them in the
 -- canonical store, but omit them from the portrayal and density competition.
 AND (f.object_class<>'SOUNDG' OR jsonb_typeof(f.attributes->'DEPTH')='number')
 -- SCAMIN is the largest display-scale denominator at which a detail is shown.
 -- Apply it before emitting either MVT layer so icons, sector arcs and labels
 -- disappear together. Selecting one cell changes scope, not display scale.
 -- Keep continuous land/water context; missing, malformed or zero SCAMIN does
 -- not define a cutoff. Symbol collisions cannot replace this scale filter:
 -- compound light/topmark symbols deliberately allow overlap on detailed charts.
 AND (f.object_class IN ('DEPARE','DRGARE','LNDARE','COALNE') OR CASE WHEN f.attributes->>'SCAMIN' ~ '^[0-9]+$'
       THEN (f.attributes->>'SCAMIN')::double precision = 0 OR (f.attributes->>'SCAMIN')::double precision >= v.scale
       ELSE true END)
), thinned AS (
 SELECT *,CASE WHEN object_class='SOUNDG' AND density_x IS NOT NULL THEN
 row_number() OVER (PARTITION BY object_class,density_x,density_y ORDER BY
 CASE WHEN jsonb_typeof(attributes->'DEPTH')='number' THEN (attributes->>'DEPTH')::double precision ELSE 999999 END,feature_id)
 ELSE 1 END AS density_rank FROM raw_features WHERE geom IS NOT NULL
), features AS (
 SELECT feature_id,cell_name,object_class,attributes,revision_id,producer,
 compilation_scale,intended_usage,cell_selection,colour_code,geom
 FROM thinned WHERE density_rank=1
), line_features AS (
 -- MapLibre's line bucket reserves up to 10 mesh vertices per input point.
 -- Keep each path below 65535 / 10 without simplifying chart geometry. Take
 -- polygon boundaries BEFORE subdivision so split edges never become outlines.
 SELECT f.feature_id,f.cell_name,f.object_class,f.attributes,f.revision_id,f.producer,
 f.compilation_scale,f.intended_usage,f.cell_selection,f.colour_code,part.geom
 FROM features f CROSS JOIN LATERAL ST_Subdivide(ST_CollectionExtract(
   CASE WHEN ST_Dimension(f.geom)=2 THEN ST_Boundary(f.geom) ELSE f.geom END,2),6000) AS part(geom)
 WHERE ST_Dimension(f.geom)>0
), symbol_features AS (
 SELECT feature_id,cell_name,object_class,attributes,revision_id,producer,
 compilation_scale,intended_usage,cell_selection,colour_code,symbol_geom AS geom
 FROM thinned WHERE density_rank=1 AND symbol_geom IS NOT NULL
), overview AS (
 SELECT c.name AS cell_name,
 ST_AsMVTGeom(ST_Transform(c.bounds,3857),v.box,4096,128,true) AS geom
 FROM candidates c CROSS JOIN viewport v
), overview_areas AS (
 SELECT c.name AS cell_name,
 ST_AsMVTGeom(ST_Transform(c.area,3857),v.box,4096,128,true) AS geom
 FROM coverage c CROSS JOIN viewport v WHERE $1<9
), overview_area_lines AS (
 SELECT a.cell_name,part.geom FROM overview_areas a
 CROSS JOIN LATERAL ST_Subdivide(ST_Boundary(a.geom),6000) AS part(geom)
)
SELECT (SELECT COALESCE(ST_AsMVT(features,'enc',4096,'geom'),''::bytea) FROM features)
 || (SELECT COALESCE(ST_AsMVT(line_features,'enc_lines',4096,'geom'),''::bytea) FROM line_features)
 || (SELECT COALESCE(ST_AsMVT(symbol_features,'enc_symbols',4096,'geom'),''::bytea) FROM symbol_features)
 || (SELECT COALESCE(ST_AsMVT(overview,'coverage',4096,'geom'),''::bytea) FROM overview)
 || (SELECT COALESCE(ST_AsMVT(overview_areas,'coverage_areas',4096,'geom'),''::bytea) FROM overview_areas)
 || (SELECT COALESCE(ST_AsMVT(overview_area_lines,'coverage_area_lines',4096,'geom'),''::bytea) FROM overview_area_lines)
