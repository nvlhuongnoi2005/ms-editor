package enc

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"reflect"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed editing_schema.sql
var editingSchema string

func EnsureEditingSchema(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, editingSchema)
	return err
}

type editGeometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}
type editFeature struct {
	Key         string         `json:"key"`
	ObjectClass string         `json:"objectClass"`
	SourceID    string         `json:"sourceId"`
	Geometry    editGeometry   `json:"geometry"`
	Attributes  map[string]any `json:"attributes"`
	Deleted     bool           `json:"deleted"`
	CanMove     bool           `json:"canMove"`
	CanDelete   bool           `json:"canDelete"`
}
type editChange struct {
	Key   string       `json:"key"`
	After *editFeature `json:"after"`
}
type editCommit struct {
	RequestID       string       `json:"requestId"`
	ExpectedVersion int64        `json:"expectedVersion"`
	Changes         []editChange `json:"changes"`
}
type editableAttribute struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

var basicAttributes = []editableAttribute{
	{"OBJNAM", "Tên đối tượng", "text"}, {"NOBJNM", "Tên bản địa", "text"},
	{"INFORM", "Thông tin", "text"}, {"NINFOM", "Thông tin bản địa", "text"},
	{"SCAMIN", "Mẫu số tỷ lệ hiển thị tối thiểu", "number"},
}
var pointClasses = []string{"BOYLAT", "BOYCAR", "BOYISD", "BOYSAW", "BOYSPP", "BCNLAT", "BCNCAR", "BCNISD", "BCNSAW", "BCNSPP", "LIGHTS", "LNDMRK", "OBSTRN", "UWTROC", "WRECKS"}

func pointClass(class string) bool {
	for _, name := range pointClasses {
		if name == class {
			return true
		}
	}
	return false
}
func editFailure(w http.ResponseWriter, status int, code, message string) error {
	respond(w, status, map[string]string{"code": code, "error": message})
	return nil
}
func decodeEdit(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("expected a single JSON document")
	}
	return nil
}

func (h *Handler) editing(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	path := strings.TrimPrefix(r.URL.Path, "/api/enc/workspaces")
	if path == "" && r.Method == http.MethodPost {
		return h.createWorkspace(ctx, w, r)
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 1 || !datasetUUID.MatchString(parts[0]) {
		return editFailure(w, 400, "invalid_workspace", "Không gian biên tập không hợp lệ.")
	}
	id := parts[0]
	token := r.Header.Get("X-ENC-Workspace-Token")
	if len(token) != 64 {
		return editFailure(w, 403, "workspace_access", "Không có quyền mở không gian biên tập này.")
	}
	hash := sha256.Sum256([]byte(token))
	var stored []byte
	var base, cell, storage string
	var version int64
	var sourceChanged bool
	var bounds json.RawMessage
	err := h.DB.QueryRow(ctx, `SELECT w.token_hash,w.base_revision,w.version,r.cell_name,r.storage_dataset_id::text,
 NOT EXISTS(SELECT 1 FROM enc.active_cell a WHERE a.revision_id=w.base_revision),
 CASE WHEN c.bounds IS NULL THEN NULL ELSE jsonb_build_array(ST_XMin(c.bounds),ST_YMin(c.bounds),ST_XMax(c.bounds),ST_YMax(c.bounds)) END
 FROM enc.workspace w JOIN enc.cell_revision r ON r.id=w.base_revision JOIN enc.cell c ON c.dataset_id=r.storage_dataset_id AND c.name=r.cell_name WHERE w.id=$1`, id).Scan(&stored, &base, &version, &cell, &storage, &sourceChanged, &bounds)
	if errors.Is(err, pgx.ErrNoRows) {
		return editFailure(w, 404, "workspace_missing", "Không tìm thấy không gian biên tập.")
	}
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(stored, hash[:]) != 1 {
		return editFailure(w, 403, "workspace_access", "Không có quyền mở không gian biên tập này.")
	}
	switch {
	case len(parts) == 5 && parts[1] == "tiles" && r.Method == http.MethodGet:
		clone := r.Clone(ctx)
		clone.URL.Path = "/api/enc/tiles/" + strings.Join(parts[2:], "/")
		query := clone.URL.Query()
		query.Set("dataset", "")
		query.Set("cell", cell)
		clone.URL.RawQuery = query.Encode()
		return h.tileForRevision(ctx, w, clone, base)
	case len(parts) == 1 && r.Method == http.MethodGet:
		var features json.RawMessage
		// Version and documents must come from one PostgreSQL snapshot.
		if err = h.DB.QueryRow(ctx, `SELECT w.version,COALESCE(jsonb_agg(f.document ORDER BY f.feature_key) FILTER (WHERE f.feature_key IS NOT NULL),'[]'::jsonb)
 FROM enc.workspace w LEFT JOIN enc.workspace_feature f ON f.workspace_id=w.id WHERE w.id=$1 GROUP BY w.id,w.version`, id).Scan(&version, &features); err != nil {
			return err
		}
		respond(w, 200, map[string]any{"id": id, "baseRevision": base, "version": version, "cellName": cell, "sourceChanged": sourceChanged, "bounds": bounds, "features": features, "attributes": basicAttributes, "pointClasses": pointClasses})
		return nil
	case len(parts) == 2 && parts[1] == "feature" && r.Method == http.MethodGet:
		feature, err := h.readEditFeature(ctx, h.DB, storage, cell, r.URL.Query().Get("key"))
		if errors.Is(err, pgx.ErrNoRows) {
			return editFailure(w, 404, "feature_missing", "Đối tượng không thuộc phiên bản đang biên tập.")
		}
		if err != nil {
			return err
		}
		respond(w, 200, feature)
		return nil
	case len(parts) == 2 && parts[1] == "commits" && r.Method == http.MethodPost:
		return h.commitWorkspace(ctx, w, r, id, storage, cell)
	default:
		return editFailure(w, 404, "route_missing", "Không tìm thấy thao tác biên tập ENC.")
	}
}

func (h *Handler) createWorkspace(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	var body struct {
		ID           string `json:"id"`
		BaseRevision string `json:"baseRevision"`
		Token        string `json:"token"`
	}
	if err := decodeEdit(w, r, &body); err != nil || !datasetUUID.MatchString(body.ID) || len(body.Token) != 64 || len(body.BaseRevision) > 200 || body.BaseRevision == "" {
		return editFailure(w, 400, "invalid_workspace", "Thông tin tạo không gian biên tập không hợp lệ.")
	}
	hash := sha256.Sum256([]byte(body.Token))
	// One catalog lock also protects source storage from concurrent import deletion.
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(713480192)`); err != nil {
		return err
	}
	var stored []byte
	var base string
	err = tx.QueryRow(ctx, `SELECT token_hash,base_revision FROM enc.workspace WHERE id=$1`, body.ID).Scan(&stored, &base)
	if err == nil {
		if base != body.BaseRevision || subtle.ConstantTimeCompare(stored, hash[:]) != 1 {
			return editFailure(w, 409, "workspace_conflict", "Không thể dùng lại không gian biên tập này.")
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM enc.active_cell WHERE revision_id=$1)`, body.BaseRevision).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return editFailure(w, 409, "source_changed", "Hải đồ nguồn đã thay đổi. Tải lại danh mục trước khi biên tập.")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO enc.workspace(id,base_revision,token_hash) VALUES($1,$2,$3)`, body.ID, body.BaseRevision, hash[:]); err != nil {
			return err
		}
	} else {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	respond(w, 200, map[string]string{"id": body.ID})
	return nil
}

type editQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (h *Handler) readEditFeature(ctx context.Context, db editQuerier, storage, cell, key string) (editFeature, error) {
	var f editFeature
	class, sourceID, validKey := strings.Cut(key, "/")
	if !validKey || class == "" || sourceID == "" || len(key) > 500 {
		return f, pgx.ErrNoRows
	}
	var attrs json.RawMessage
	var geometry json.RawMessage
	var exclusive bool
	err := db.QueryRow(ctx, `SELECT f.object_class,f.source_id,f.attributes,COALESCE(f.source_geometry,ST_AsGeoJSON(f.geometry)::jsonb),
 CASE WHEN ST_GeometryType(f.geometry)='ST_Point' AND f.object_class=ANY($5::text[]) THEN
 COALESCE(f.attributes->'LNAM_REFS','[]'::jsonb)='[]'::jsonb AND
 NOT EXISTS(SELECT 1 FROM enc.feature other WHERE other.dataset_id=f.dataset_id AND other.cell_name=f.cell_name
 AND (other.object_class,other.source_id)<>(f.object_class,f.source_id)
 AND (EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.attributes->'NAME_RCID')='array' THEN f.attributes->'NAME_RCID' ELSE '[]'::jsonb END) WITH ORDINALITY ids(id,n)
 JOIN jsonb_array_elements_text(CASE WHEN jsonb_typeof(other.attributes->'NAME_RCID')='array' THEN other.attributes->'NAME_RCID' ELSE '[]'::jsonb END) WITH ORDINALITY refs(id,n) ON ids.id=refs.id
 WHERE COALESCE(f.attributes->'NAME_RCNM'->>(ids.n::integer-1),'unknown')=COALESCE(other.attributes->'NAME_RCNM'->>(refs.n::integer-1),'unknown'))
 OR (f.lnam IS NOT NULL AND (other.lnam=f.lnam OR COALESCE(other.attributes->'LNAM_REFS','[]'::jsonb) ? f.lnam))
 )) ELSE false END
 FROM enc.feature f WHERE f.dataset_id=$1 AND f.cell_name=$2 AND f.object_class=$3 AND f.source_id=$4`, storage, cell, class, sourceID, pointClasses).Scan(&f.ObjectClass, &f.SourceID, &attrs, &geometry, &exclusive)
	if err != nil {
		return f, err
	}
	if err = json.Unmarshal(attrs, &f.Attributes); err != nil {
		return f, err
	}
	if err = json.Unmarshal(geometry, &f.Geometry); err != nil {
		return f, err
	}
	f.Key = key
	var coordinates []float64
	// ConnectedNode can also be used by an Edge's endpoints even when feature FSPT
	// references differ. Only proven IsolatedNode links are movable in this phase.
	primitiveTypes, typesOK := f.Attributes["NAME_RCNM"].([]any)
	primitiveIDs, idsOK := f.Attributes["NAME_RCID"].([]any)
	isolated := typesOK && idsOK && len(primitiveTypes) == 1 && len(primitiveIDs) == 1 && fmt.Sprint(primitiveTypes[0]) == "110"
	f.CanMove = isolated && exclusive && pointClass(f.ObjectClass) && f.Geometry.Type == "Point" && json.Unmarshal(f.Geometry.Coordinates, &coordinates) == nil && len(coordinates) == 2
	f.CanDelete = f.CanMove
	return f, nil
}

func validateEditFeature(after, before *editFeature) error {
	if after == nil {
		return nil
	} // Reset an override to the immutable source.
	if after.Attributes == nil || len(after.Key) > 500 || after.Key != after.ObjectClass+"/"+after.SourceID {
		return fmt.Errorf("Định danh đối tượng không hợp lệ.")
	}
	if before == nil {
		if !pointClass(after.ObjectClass) || !strings.HasPrefix(after.SourceID, "new:") || !datasetUUID.MatchString(strings.TrimPrefix(after.SourceID, "new:")) || after.Deleted {
			return fmt.Errorf("Chỉ hỗ trợ tạo đối tượng điểm trong bản này.")
		}
	} else {
		if after.Key != before.Key || after.ObjectClass != before.ObjectClass || after.SourceID != before.SourceID {
			return fmt.Errorf("Không được đổi định danh nguồn.")
		}
		if after.Deleted && !before.CanDelete {
			return fmt.Errorf("Chưa hỗ trợ xóa đối tượng có liên kết hoặc không phải điểm độc lập.")
		}
		if before.ObjectClass == "SOUNDG" {
			return fmt.Errorf("SOUNDG được bảo vệ; cần bộ biên tập độ sâu và nhóm điểm.")
		}
	}
	original := map[string]any{}
	if before != nil {
		original = before.Attributes
	}
	allowed := map[string]string{}
	for _, a := range basicAttributes {
		allowed[a.Key] = a.Kind
	}
	keys := map[string]bool{}
	for k := range original {
		keys[k] = true
	}
	for k := range after.Attributes {
		keys[k] = true
	}
	for key := range keys {
		a, aok := after.Attributes[key]
		b, bok := original[key]
		if aok == bok && reflect.DeepEqual(a, b) {
			continue
		}
		kind, ok := allowed[key]
		if !ok {
			return fmt.Errorf("Thuộc tính %s được bảo vệ trong bản biên tập cơ bản.", key)
		}
		if !aok {
			continue
		}
		if kind == "text" {
			s, ok := a.(string)
			if !ok || len(s) > 4096 {
				return fmt.Errorf("Thuộc tính %s phải là văn bản tối đa 4096 byte.", key)
			}
		} else {
			n, ok := a.(float64)
			if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 1e10 || n != math.Trunc(n) {
				return fmt.Errorf("Thuộc tính %s phải là số nguyên không âm.", key)
			}
		}
	}
	if before != nil && sameEditGeometry(after.Geometry, before.Geometry) {
		return nil
	}
	if before != nil && !before.CanMove {
		return fmt.Errorf("Hình học có liên kết hoặc không thuộc phạm vi biên tập điểm.")
	}
	var coordinates []float64
	if after.Geometry.Type != "Point" || json.Unmarshal(after.Geometry.Coordinates, &coordinates) != nil || len(coordinates) != 2 || math.IsNaN(coordinates[0]) || math.IsNaN(coordinates[1]) || math.IsInf(coordinates[0], 0) || math.IsInf(coordinates[1], 0) || math.Abs(coordinates[0]) > 180 || math.Abs(coordinates[1]) > 90 {
		return fmt.Errorf("Tọa độ điểm không hợp lệ; phải gồm kinh độ và vĩ độ.")
	}
	return nil
}

func sameEditGeometry(a, b editGeometry) bool {
	var ac, bc any
	return a.Type == b.Type && json.Unmarshal(a.Coordinates, &ac) == nil && json.Unmarshal(b.Coordinates, &bc) == nil && reflect.DeepEqual(ac, bc)
}

func (h *Handler) commitWorkspace(ctx context.Context, w http.ResponseWriter, r *http.Request, id, storage, cell string) error {
	var body editCommit
	if err := decodeEdit(w, r, &body); err != nil || !datasetUUID.MatchString(body.RequestID) || body.ExpectedVersion < 0 || len(body.Changes) == 0 || len(body.Changes) > 500 {
		return editFailure(w, 400, "invalid_commit", "Phiên thay đổi không hợp lệ hoặc vượt quá 500 đối tượng.")
	}
	payload, _ := json.Marshal(body)
	hash := sha256.Sum256(payload)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var version int64
	if err = tx.QueryRow(ctx, `SELECT version FROM enc.workspace WHERE id=$1 FOR UPDATE`, id).Scan(&version); err != nil {
		return err
	}
	var previousHash []byte
	var committedVersion int64
	err = tx.QueryRow(ctx, `SELECT payload_hash,version FROM enc.workspace_commit WHERE workspace_id=$1 AND request_id=$2`, id, body.RequestID).Scan(&previousHash, &committedVersion)
	if err == nil {
		if subtle.ConstantTimeCompare(previousHash, hash[:]) != 1 {
			return editFailure(w, 409, "request_conflict", "Mã yêu cầu đã được dùng cho nội dung khác.")
		}
		respond(w, 200, map[string]any{"version": committedVersion, "requestId": body.RequestID})
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if version != body.ExpectedVersion {
		return editFailure(w, 409, "version_conflict", "Không gian biên tập đã được lưu ở tab khác. Giữ bản nháp và tải lại để đối soát.")
	}
	seen := map[string]bool{}
	audit := []map[string]any{}
	for _, change := range body.Changes {
		if change.Key == "" || seen[change.Key] || len(change.Key) > 500 {
			return editFailure(w, 400, "invalid_feature", "Đối tượng bị trùng hoặc không hợp lệ.")
		}
		seen[change.Key] = true
		original, readErr := h.readEditFeature(ctx, tx, storage, cell, change.Key)
		var baseline *editFeature
		if readErr == nil {
			baseline = &original
		} else if !errors.Is(readErr, pgx.ErrNoRows) {
			return readErr
		}
		if change.After != nil && change.After.Key != change.Key {
			return editFailure(w, 400, "invalid_feature", "Khóa đối tượng không khớp nội dung.")
		}
		if err = validateEditFeature(change.After, baseline); err != nil {
			return editFailure(w, 422, "invalid_feature", err.Error())
		}
		var previous json.RawMessage
		err = tx.QueryRow(ctx, `SELECT document FROM enc.workspace_feature WHERE workspace_id=$1 AND feature_key=$2`, id, change.Key).Scan(&previous)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		audit = append(audit, map[string]any{"key": change.Key, "before": previous, "after": change.After})
		if change.After == nil {
			if _, err = tx.Exec(ctx, `DELETE FROM enc.workspace_feature WHERE workspace_id=$1 AND feature_key=$2`, id, change.Key); err != nil {
				return err
			}
		} else {
			change.After.CanMove = baseline == nil || baseline.CanMove
			change.After.CanDelete = baseline == nil || baseline.CanDelete
			doc, _ := json.Marshal(change.After)
			if _, err = tx.Exec(ctx, `INSERT INTO enc.workspace_feature(workspace_id,feature_key,document) VALUES($1,$2,$3::jsonb) ON CONFLICT(workspace_id,feature_key) DO UPDATE SET document=EXCLUDED.document`, id, change.Key, doc); err != nil {
				return err
			}
		}
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM enc.workspace_feature WHERE workspace_id=$1`, id).Scan(&count); err != nil {
		return err
	}
	if count > 1000 {
		return editFailure(w, 422, "workspace_limit", "Bản biên tập cơ bản giới hạn 1000 đối tượng thay đổi trong mỗi workspace.")
	}
	version++
	auditJSON, _ := json.Marshal(audit)
	if _, err = tx.Exec(ctx, `INSERT INTO enc.workspace_commit(workspace_id,request_id,payload_hash,version,changes) VALUES($1,$2,$3,$4,$5::jsonb)`, id, body.RequestID, hash[:], version, auditJSON); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE enc.workspace SET version=$2,updated_at=now() WHERE id=$1`, id, version); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	respond(w, 200, map[string]any{"version": version, "requestId": body.RequestID})
	return nil
}
