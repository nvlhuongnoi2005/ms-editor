package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

type relationSemantic struct {
	id      int64
	tags    map[string]string
	members []member
}

type relationWay struct {
	id   int64
	refs []int64
}

// validateChangesetRelationSemantics checks the final relation topology. A way
// edit can invalidate an unchanged multipolygon or route, so relations using
// changed ways (including ways affected by a moved node) are rechecked too.
func validateChangesetRelationSemantics(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, changes []normalizedChange) error {
	relations, err := relationsForSemanticValidation(ctx, tx, datasetID, planned, changes)
	if err != nil {
		return err
	}
	if len(relations) == 0 {
		return nil
	}
	ways, err := finalRelationWays(ctx, tx, datasetID, planned, relations)
	if err != nil {
		return err
	}
	wayGeometries := make([]wayGeometry, 0, len(ways))
	for _, way := range ways {
		wayGeometries = append(wayGeometries, wayGeometry{id: way.id, nodeRefs: way.refs})
	}
	coordinates, err := finalNodeCoordinates(ctx, tx, datasetID, planned, wayGeometries)
	if err != nil {
		return err
	}
	for _, relation := range relations {
		switch relation.tags["type"] {
		case "multipolygon":
			if err := validateMultipolygonRelation(relation, ways, coordinates); err != nil {
				return err
			}
		case "route":
			if err := validateRouteRelation(relation, ways); err != nil {
				return err
			}
		}
	}
	return nil
}

func relationsForSemanticValidation(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, changes []normalizedChange) ([]relationSemantic, error) {
	byID := make(map[int64]relationSemantic)
	changedWayIDs := make([]int64, 0)
	movedNodeIDs := make([]int64, 0)
	for _, change := range changes {
		switch change.Type {
		case "relation":
			if change.Operation != "delete" {
				byID[change.ID] = relationSemantic{id: change.ID, tags: change.Tags, members: change.Members}
			}
		case "way":
			if change.Operation != "delete" {
				changedWayIDs = append(changedWayIDs, change.ID)
			}
		case "node":
			if change.Operation != "delete" {
				movedNodeIDs = append(movedNodeIDs, change.ID)
			}
		}
	}
	if len(movedNodeIDs) > 0 {
		rows, err := tx.Query(ctx, `SELECT entity_id FROM editor.entity_current
			WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible
				AND node_refs && $2::bigint[]`, datasetID, uniqueIDs(movedNodeIDs))
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			if change, changed := planned[topologyKey("way", id)]; !changed || change.Operation != "delete" {
				changedWayIDs = append(changedWayIDs, id)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	if len(changedWayIDs) > 0 {
		rows, err := tx.Query(ctx, `SELECT entity_id, tags, members FROM editor.entity_current relation
			WHERE relation.dataset_id=$1 AND relation.entity_type='relation'::editor.entity_type AND relation.visible
				AND EXISTS (
					SELECT 1 FROM jsonb_to_recordset(relation.members) AS member(type text, ref bigint, role text, sequence integer)
					WHERE member.type='way' AND member.ref=ANY($2::bigint[])
				)`, datasetID, uniqueIDs(changedWayIDs))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			var tagsJSON, membersJSON []byte
			if err := rows.Scan(&id, &tagsJSON, &membersJSON); err != nil {
				return nil, err
			}
			if _, changed := planned[topologyKey("relation", id)]; changed {
				continue
			}
			var members []member
			if err := json.Unmarshal(membersJSON, &members); err != nil {
				return nil, fail(500, "Stored relation %d members are invalid.", id)
			}
			byID[id] = relationSemantic{id: id, tags: tagsFromJSON(tagsJSON), members: members}
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	ids := make([]int64, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(left, right int) bool { return ids[left] < ids[right] })
	result := make([]relationSemantic, 0, len(ids))
	for _, id := range ids {
		result = append(result, byID[id])
	}
	return result, nil
}

func finalRelationWays(ctx context.Context, tx pgx.Tx, datasetID string, planned map[string]normalizedChange, relations []relationSemantic) (map[int64]relationWay, error) {
	needed := make(map[int64]struct{})
	for _, relation := range relations {
		if relation.tags["type"] != "multipolygon" && relation.tags["type"] != "route" {
			continue
		}
		for _, item := range relation.members {
			if item.Type == "way" {
				needed[item.Ref] = struct{}{}
			}
		}
	}
	ways := make(map[int64]relationWay, len(needed))
	missing := make([]int64, 0, len(needed))
	for id := range needed {
		if change, changed := planned[topologyKey("way", id)]; changed {
			if change.Operation == "delete" {
				return nil, fail(422, "Relation geometry references deleted way %d.", id)
			}
			ways[id] = relationWay{id: id, refs: change.NodeRefs}
			continue
		}
		missing = append(missing, id)
	}
	if len(missing) == 0 {
		return ways, nil
	}
	rows, err := tx.Query(ctx, `SELECT entity_id, node_refs FROM editor.entity_current
		WHERE dataset_id=$1 AND entity_type='way'::editor.entity_type AND visible AND entity_id=ANY($2::bigint[])`, datasetID, missing)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var refs []int64
		if err := rows.Scan(&id, &refs); err != nil {
			return nil, err
		}
		ways[id] = relationWay{id: id, refs: refs}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, id := range missing {
		if _, found := ways[id]; !found {
			return nil, fail(409, "A relation references a missing or deleted way.")
		}
	}
	return ways, nil
}

func validateMultipolygonRelation(relation relationSemantic, ways map[int64]relationWay, coordinates map[int64]geometryCoordinate) error {
	outerWays, innerWays := make([]relationWay, 0), make([]relationWay, 0)
	seen := make(map[int64]struct{})
	for index, item := range relation.members {
		if item.Type != "way" {
			return fail(422, "Multipolygon relation %d member %d must be a way.", relation.id, index+1)
		}
		role := strings.TrimSpace(item.Role)
		if role != "" && role != "outer" && role != "inner" {
			return fail(422, "Multipolygon relation %d member %d has invalid role %q.", relation.id, index+1, item.Role)
		}
		if _, duplicate := seen[item.Ref]; duplicate {
			return fail(422, "Multipolygon relation %d contains way %d more than once.", relation.id, item.Ref)
		}
		seen[item.Ref] = struct{}{}
		way, found := ways[item.Ref]
		if !found {
			return fail(422, "Multipolygon relation %d references way %d without geometry.", relation.id, item.Ref)
		}
		if role == "inner" {
			innerWays = append(innerWays, way)
		} else {
			outerWays = append(outerWays, way)
		}
	}
	if len(outerWays) == 0 {
		return fail(422, "Multipolygon relation %d must contain at least one outer way.", relation.id)
	}
	outerRings, err := assembleRelationRings(outerWays)
	if err != nil {
		return fail(422, "Multipolygon relation %d outer members are invalid: %s", relation.id, err)
	}
	innerRings, err := assembleRelationRings(innerWays)
	if err != nil {
		return fail(422, "Multipolygon relation %d inner members are invalid: %s", relation.id, err)
	}
	outerPoints, err := relationRingPoints(outerRings, coordinates)
	if err != nil {
		return fail(422, "Multipolygon relation %d has invalid outer geometry: %s", relation.id, err)
	}
	innerPoints, err := relationRingPoints(innerRings, coordinates)
	if err != nil {
		return fail(422, "Multipolygon relation %d has invalid inner geometry: %s", relation.id, err)
	}
	if relationRingsIntersect(outerPoints) || relationRingsIntersect(innerPoints) || ringsCrossEachOther(outerPoints, innerPoints) {
		return fail(422, "Multipolygon relation %d has intersecting rings.", relation.id)
	}
	for _, inner := range innerPoints {
		if !ringInsideAnyOuter(inner, outerPoints) {
			return fail(422, "Multipolygon relation %d has an inner ring outside its outer ring.", relation.id)
		}
	}
	return nil
}

func assembleRelationRings(ways []relationWay) ([][]int64, error) {
	if len(ways) == 0 {
		return nil, nil
	}
	openByEndpoint := make(map[int64]int)
	for _, way := range ways {
		if len(way.refs) < 2 {
			return nil, fmt.Errorf("way %d has fewer than two nodes", way.id)
		}
		if way.refs[0] != way.refs[len(way.refs)-1] {
			openByEndpoint[way.refs[0]]++
			openByEndpoint[way.refs[len(way.refs)-1]]++
		}
	}
	for nodeID, degree := range openByEndpoint {
		if degree != 2 {
			return nil, fmt.Errorf("node %d has degree %d instead of 2", nodeID, degree)
		}
	}
	unused := make(map[int64]relationWay, len(ways))
	for _, way := range ways {
		unused[way.id] = way
	}
	rings := make([][]int64, 0)
	for len(unused) > 0 {
		var first relationWay
		// Keep input member order: map iteration randomly rotated otherwise
		// identical rings and made validation results/tests nondeterministic.
		for _, way := range ways {
			if _, available := unused[way.id]; available {
				first = way
				break
			}
		}
		delete(unused, first.id)
		path := append([]int64(nil), first.refs...)
		if path[0] == path[len(path)-1] {
			rings = append(rings, path)
			continue
		}
		start, endpoint := path[0], path[len(path)-1]
		for endpoint != start {
			var next relationWay
			matches := 0
			for _, candidate := range unused {
				if candidate.refs[0] == endpoint || candidate.refs[len(candidate.refs)-1] == endpoint {
					next = candidate
					matches++
				}
			}
			if matches != 1 {
				return nil, fmt.Errorf("way chain ending at node %d is not closed", endpoint)
			}
			delete(unused, next.id)
			next.refs = append([]int64(nil), next.refs...)
			if next.refs[len(next.refs)-1] == endpoint {
				for left, right := 0, len(next.refs)-1; left < right; left, right = left+1, right-1 {
					next.refs[left], next.refs[right] = next.refs[right], next.refs[left]
				}
			}
			path = append(path, next.refs[1:]...)
			endpoint = path[len(path)-1]
		}
		rings = append(rings, path)
	}
	return rings, nil
}

func relationRingPoints(rings [][]int64, coordinates map[int64]geometryCoordinate) ([][]geometryCoordinate, error) {
	pointsByRing := make([][]geometryCoordinate, 0, len(rings))
	for _, ring := range rings {
		if len(ring) < 4 || ring[0] != ring[len(ring)-1] {
			return nil, fmt.Errorf("ring is not closed")
		}
		points := make([]geometryCoordinate, 0, len(ring))
		for _, nodeID := range ring {
			point, found := coordinates[nodeID]
			if !found {
				return nil, fmt.Errorf("node %d has no coordinate", nodeID)
			}
			points = append(points, point)
		}
		if !validGeometryBBox(points) || polygonDirection(points) == ringDegenerate || polygonSelfIntersects(points) {
			return nil, fmt.Errorf("ring is degenerate or self-intersecting")
		}
		pointsByRing = append(pointsByRing, points)
	}
	return pointsByRing, nil
}

func relationRingsIntersect(rings [][]geometryCoordinate) bool {
	for left := 0; left < len(rings); left++ {
		for right := left + 1; right < len(rings); right++ {
			if ringsIntersect(rings[left], rings[right]) {
				return true
			}
		}
	}
	return false
}

func ringsCrossEachOther(left, right [][]geometryCoordinate) bool {
	for _, leftRing := range left {
		for _, rightRing := range right {
			if ringsIntersect(leftRing, rightRing) {
				return true
			}
		}
	}
	return false
}

func ringsIntersect(left, right []geometryCoordinate) bool {
	for leftIndex := 0; leftIndex < len(left)-1; leftIndex++ {
		for rightIndex := 0; rightIndex < len(right)-1; rightIndex++ {
			if segmentsIntersect(left[leftIndex], left[leftIndex+1], right[rightIndex], right[rightIndex+1]) {
				return true
			}
		}
	}
	return false
}

func ringInsideAnyOuter(inner []geometryCoordinate, outers [][]geometryCoordinate) bool {
	if len(inner) < 2 {
		return false
	}
	for _, outer := range outers {
		if pointInRing(inner[0], outer) {
			return true
		}
	}
	return false
}

func pointInRing(point geometryCoordinate, ring []geometryCoordinate) bool {
	inside := false
	for index, previous := 0, len(ring)-1; index < len(ring); previous, index = index, index+1 {
		left, right := ring[previous], ring[index]
		if orientation(left, right, point) == 0 && pointOnSegment(left, right, point) {
			return false
		}
		if (left.lat > point.lat) != (right.lat > point.lat) {
			intersectLon := float64(right.lon-left.lon)*float64(point.lat-left.lat)/float64(right.lat-left.lat) + float64(left.lon)
			if float64(point.lon) < intersectLon {
				inside = !inside
			}
		}
	}
	return inside
}

func validateRouteRelation(relation relationSemantic, ways map[int64]relationWay) error {
	if len(relation.members) == 0 {
		return fail(422, "Route relation %d must contain members.", relation.id)
	}
	lastWayByBranch := make(map[string]relationWay)
	routeWays := 0
	for index, item := range relation.members {
		role := strings.TrimSpace(item.Role)
		if !validRouteRole(role) {
			return fail(422, "Route relation %d member %d has invalid role %q.", relation.id, index+1, item.Role)
		}
		if (role == "forward" || role == "backward" || role == "alternate") && item.Type != "way" {
			return fail(422, "Route relation %d member %d role %q must reference a way.", relation.id, index+1, role)
		}
		if item.Type != "way" || isRouteStopRole(role) {
			continue
		}
		way, found := ways[item.Ref]
		if !found || len(way.refs) < 2 {
			return fail(422, "Route relation %d member %d has no usable way geometry.", relation.id, index+1)
		}
		routeWays++
		branch := "main"
		if role == "alternate" {
			branch = "alternate"
		}
		if previous, exists := lastWayByBranch[branch]; exists && !waysConnect(previous, way) {
			return fail(422, "Route relation %d is disconnected between way %d and way %d.", relation.id, previous.id, way.id)
		}
		lastWayByBranch[branch] = way
	}
	if routeWays == 0 {
		return fail(422, "Route relation %d must contain at least one route way.", relation.id)
	}
	return nil
}

func validRouteRole(role string) bool {
	switch role {
	case "", "forward", "backward", "alternate", "stop", "platform", "stop_entry_only", "stop_exit_only", "platform_entry_only", "platform_exit_only":
		return true
	default:
		return false
	}
}

func isRouteStopRole(role string) bool {
	switch role {
	case "stop", "platform", "stop_entry_only", "stop_exit_only", "platform_entry_only", "platform_exit_only":
		return true
	default:
		return false
	}
}

func waysConnect(left, right relationWay) bool {
	leftStart, leftEnd := left.refs[0], left.refs[len(left.refs)-1]
	rightStart, rightEnd := right.refs[0], right.refs[len(right.refs)-1]
	return leftStart == rightStart || leftStart == rightEnd || leftEnd == rightStart || leftEnd == rightEnd
}
