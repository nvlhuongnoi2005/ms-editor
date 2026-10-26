package main

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5"
)

// geometryCoordinate deliberately stays in E7 integer coordinates. It avoids
// introducing rounding differences between validation and the canonical store.
type geometryCoordinate struct {
	lon int64
	lat int64
}

type wayGeometry struct {
	id       int64
	tags     map[string]string
	nodeRefs []int64
}

type ringDirection int

const (
	ringDegenerate ringDirection = iota
	ringCounterClockwise
	ringClockwise
)

// isAreaWayTags is intentionally conservative: a closed highway, for example,
// is still a line unless it is explicitly tagged as an area. It mirrors the
// graph representation so that the editor and validator agree on what is a
// polygon.
func isAreaWayTags(tags map[string]string) bool {
	if tags["area"] == "yes" || tags["building"] != "" || tags["landuse"] != "" || tags["leisure"] != "" || tags["amenity"] != "" || tags["aeroway"] != "" {
		return true
	}
	switch tags["natural"] {
	case "water", "wood", "scrub", "wetland", "beach", "sand":
		return true
	default:
		return false
	}
}

// validateChangesetGeometry validates the final geometry, rather than only the
// rows included in the upload. Moving a node can make an unchanged parent way
// invalid, so those affected ways are included as well.
func validateChangesetGeometry(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, changes []normalizedChange) error {
	ways, err := waysForGeometryValidation(ctx, tx, datasetID, planned, changes)
	if err != nil {
		return err
	}
	coordinates, err := finalNodeCoordinates(ctx, tx, datasetID, planned, ways)
	if err != nil {
		return err
	}
	for _, way := range ways {
		if err := validateWayGeometry(way, coordinates); err != nil {
			return err
		}
	}
	return nil
}

func waysForGeometryValidation(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, changes []normalizedChange) ([]wayGeometry, error) {
	byID := make(map[int64]wayGeometry)
	movedNodeIDs := make([]int64, 0)
	for _, change := range changes {
		switch change.Type {
		case "way":
			if change.Operation != "delete" {
				byID[change.ID] = wayGeometry{id: change.ID, tags: change.Tags, nodeRefs: change.NodeRefs}
			}
		case "node":
			if change.Operation != "delete" {
				movedNodeIDs = append(movedNodeIDs, change.ID)
			}
		}
	}
	if len(movedNodeIDs) == 0 {
		return mapWays(byID), nil
	}

	rows, err := tx.Query(ctx, `SELECT entity_id, tags, node_refs
		FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible
			AND node_refs && $2::bigint[]`, datasetID, uniqueIDs(movedNodeIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var tagsJSON []byte
		var refs []int64
		if err := rows.Scan(&id, &tagsJSON, &refs); err != nil {
			return nil, err
		}
		// A changed way above already represents its final state; a planned
		// deletion has no final geometry to validate.
		if _, changed := planned[topologyKey("way", id)]; changed {
			continue
		}
		byID[id] = wayGeometry{id: id, tags: tagsFromJSON(tagsJSON), nodeRefs: refs}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return mapWays(byID), nil
}

func mapWays(byID map[int64]wayGeometry) []wayGeometry {
	ways := make([]wayGeometry, 0, len(byID))
	for _, way := range byID {
		ways = append(ways, way)
	}
	return ways
}

func finalNodeCoordinates(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, ways []wayGeometry) (map[int64]geometryCoordinate, error) {
	needed := make(map[int64]struct{})
	for _, way := range ways {
		for _, nodeID := range way.nodeRefs {
			needed[nodeID] = struct{}{}
		}
	}
	coordinates := make(map[int64]geometryCoordinate, len(needed))
	missing := make([]int64, 0, len(needed))
	for nodeID := range needed {
		if change, changed := planned[topologyKey("node", nodeID)]; changed {
			if change.Operation == "delete" || change.LonE7 == nil || change.LatE7 == nil {
				return nil, fail(422, "Way geometry references node %d without final coordinates.", nodeID)
			}
			coordinates[nodeID] = geometryCoordinate{lon: *change.LonE7, lat: *change.LatE7}
			continue
		}
		missing = append(missing, nodeID)
	}
	if len(missing) == 0 {
		return coordinates, nil
	}
	rows, err := tx.Query(ctx, `SELECT entity_id, node_lon_e7, node_lat_e7
		FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='node'::editor.entity_type AND visible
			AND entity_id=ANY($2::bigint[])`, datasetID, missing)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var lon, lat *int64
		if err := rows.Scan(&id, &lon, &lat); err != nil {
			return nil, err
		}
		if lon == nil || lat == nil {
			return nil, fail(422, "Node %d has invalid coordinates.", id)
		}
		coordinates[id] = geometryCoordinate{lon: *lon, lat: *lat}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, nodeID := range missing {
		if _, found := coordinates[nodeID]; !found {
			return nil, fail(409, "A way references a missing or deleted node.")
		}
	}
	return coordinates, nil
}

func validateWayGeometry(way wayGeometry, coordinates map[int64]geometryCoordinate) error {
	if len(way.nodeRefs) < 2 {
		return fail(422, "Way %d must contain at least two nodes.", way.id)
	}
	points := make([]geometryCoordinate, 0, len(way.nodeRefs))
	for index, nodeID := range way.nodeRefs {
		point, found := coordinates[nodeID]
		if !found {
			return fail(422, "Way %d references node %d without coordinates.", way.id, nodeID)
		}
		if !validGeometryCoordinate(point) {
			return fail(422, "Way %d has coordinates outside WGS84 bounds.", way.id)
		}
		if index > 0 {
			previous := points[index-1]
			if way.nodeRefs[index-1] == nodeID || previous == point {
				return fail(422, "Way %d contains consecutive duplicate nodes.", way.id)
			}
		}
		points = append(points, point)
	}

	if !isAreaWayTags(way.tags) {
		return nil
	}
	if len(way.nodeRefs) < 4 {
		return fail(422, "Area way %d must contain at least three vertices and a closing node.", way.id)
	}
	if way.nodeRefs[0] != way.nodeRefs[len(way.nodeRefs)-1] {
		return fail(422, "Area way %d must be closed by repeating its first node.", way.id)
	}
	if points[0] != points[len(points)-1] {
		return fail(422, "Area way %d has an invalid closing coordinate.", way.id)
	}
	vertices := make(map[geometryCoordinate]struct{}, len(points)-1)
	for _, point := range points[:len(points)-1] {
		vertices[point] = struct{}{}
	}
	if len(vertices) < 3 {
		return fail(422, "Area way %d must contain at least three distinct vertices.", way.id)
	}
	if !validGeometryBBox(points) {
		return fail(422, "Area way %d has an invalid bounding box.", way.id)
	}
	if polygonDirection(points) == ringDegenerate {
		return fail(422, "Area way %d has zero area or an invalid ring direction.", way.id)
	}
	if polygonSelfIntersects(points) {
		return fail(422, "Area way %d intersects itself.", way.id)
	}
	return nil
}

func validGeometryCoordinate(point geometryCoordinate) bool {
	return point.lon >= -1_800_000_000 && point.lon <= 1_800_000_000 && point.lat >= -900_000_000 && point.lat <= 900_000_000
}

func validGeometryBBox(points []geometryCoordinate) bool {
	if len(points) == 0 {
		return false
	}
	minLon, maxLon := points[0].lon, points[0].lon
	minLat, maxLat := points[0].lat, points[0].lat
	for _, point := range points[1:] {
		minLon = minInt64(minLon, point.lon)
		maxLon = maxInt64(maxLon, point.lon)
		minLat = minInt64(minLat, point.lat)
		maxLat = maxInt64(maxLat, point.lat)
	}
	return minLon < maxLon && minLat < maxLat
}

func minInt64(left, right int64) int64 {
	if left < right {
		return left
	}
	return right
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

// polygonDirection evaluates the winding order but does not reject clockwise
// standalone OSM areas: OSM permits either direction there. Multipolygon
// outer/inner winding is validated in relation-specific validation.
func polygonDirection(points []geometryCoordinate) ringDirection {
	if len(points) < 4 {
		return ringDegenerate
	}
	origin := points[0]
	var twiceArea float64
	for index := 0; index < len(points)-1; index++ {
		left, right := points[index], points[index+1]
		leftX, leftY := float64(left.lon-origin.lon), float64(left.lat-origin.lat)
		rightX, rightY := float64(right.lon-origin.lon), float64(right.lat-origin.lat)
		twiceArea += leftX*rightY - rightX*leftY
	}
	if math.Abs(twiceArea) < 0.5 {
		return ringDegenerate
	}
	if twiceArea > 0 {
		return ringCounterClockwise
	}
	return ringClockwise
}

func polygonSelfIntersects(points []geometryCoordinate) bool {
	segmentCount := len(points) - 1
	for first := 0; first < segmentCount; first++ {
		for second := first + 1; second < segmentCount; second++ {
			// Neighbouring edges meet at a legitimate shared endpoint, as do
			// the first and last edge of the closed ring.
			if second == first+1 || (first == 0 && second == segmentCount-1) {
				continue
			}
			if segmentsIntersect(points[first], points[first+1], points[second], points[second+1]) {
				return true
			}
		}
	}
	return false
}

func segmentsIntersect(a, b, c, d geometryCoordinate) bool {
	abc, abd := orientation(a, b, c), orientation(a, b, d)
	cda, cdb := orientation(c, d, a), orientation(c, d, b)
	if ((abc > 0 && abd < 0) || (abc < 0 && abd > 0)) && ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0)) {
		return true
	}
	return (abc == 0 && pointOnSegment(a, b, c)) || (abd == 0 && pointOnSegment(a, b, d)) || (cda == 0 && pointOnSegment(c, d, a)) || (cdb == 0 && pointOnSegment(c, d, b))
}

func orientation(a, b, c geometryCoordinate) float64 {
	return float64(b.lon-a.lon)*float64(c.lat-a.lat) - float64(b.lat-a.lat)*float64(c.lon-a.lon)
}

func pointOnSegment(a, b, point geometryCoordinate) bool {
	return point.lon >= minInt64(a.lon, b.lon) && point.lon <= maxInt64(a.lon, b.lon) && point.lat >= minInt64(a.lat, b.lat) && point.lat <= maxInt64(a.lat, b.lat)
}
