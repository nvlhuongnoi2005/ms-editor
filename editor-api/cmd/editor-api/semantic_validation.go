package main

import (
	"net/mail"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var (
	measurementPattern  = regexp.MustCompile(`^[0-9]+(?:[.,][0-9]+)?(?:\s*(?:m|cm|mm|km|ft|in|mi|yd|t|kg|g|lbs))?$`)
	feetInchesPattern   = regexp.MustCompile(`^[0-9]+\s*'(?:\s*[0-9]+(?:[.,][0-9]+)?\s*")?$`)
	maxspeedPattern     = regexp.MustCompile(`^[0-9]+(?:[.,][0-9]+)?(?:\s*(?:km/h|kmh|kph|mph|knots))?$`)
	maxspeedCodePattern = regexp.MustCompile(`^[A-Za-z]{2,3}:[A-Za-z0-9_:-]+$`)
	phonePattern        = regexp.MustCompile(`^[0-9+()/.\-; x]+$`)
)

// validateChangesetSemantics deliberately validates only stable OSM meaning.
// OSM remains a folksonomy, so unknown tags and new values are not rejected.
// This protects the canonical data from clear type/geometry contradictions
// without turning the editor into a closed schema.
func validateChangesetSemantics(changes []normalizedChange) error {
	for _, change := range changes {
		if change.Operation == "delete" {
			continue
		}
		if err := validateEntityTagSemantics(change); err != nil {
			return err
		}
	}
	return nil
}

func validateEntityTagSemantics(change normalizedChange) error {
	for key, value := range change.Tags {
		if strings.TrimSpace(key) == "" || strings.ContainsRune(key, '=') || strings.IndexFunc(key, unicode.IsSpace) >= 0 {
			return fail(422, "%s %d has an invalid tag key %q.", change.Type, change.ID, key)
		}
		if strings.ContainsAny(value, "\r\n\x00") {
			return fail(422, "%s %d tag %q contains an invalid value.", change.Type, change.ID, key)
		}
	}
	if err := validateSemanticTagValues(change); err != nil {
		return err
	}
	return validateSemanticGeometry(change)
}

func validateSemanticTagValues(change normalizedChange) error {
	tags := change.Tags
	// These tags have an established boolean domain.  Tags such as bridge,
	// wheelchair or fee intentionally stay out of this list: they have useful
	// non-boolean OSM values (for example bridge=viaduct, wheelchair=limited).
	for _, key := range []string{"intermittent", "seasonal", "tidal", "cash_in", "takeaway", "delivery", "dispensing"} {
		if value, exists := tags[key]; exists && !isYesNoUnknown(value) {
			return fail(422, "%s %d tag %s must be yes, no, or unknown.", change.Type, change.ID, key)
		}
	}
	if value, exists := tags["oneway"]; exists && !isOneway(value) {
		return fail(422, "%s %d tag oneway must be yes, no, -1, reversible, or alternating.", change.Type, change.ID)
	}
	for _, key := range []string{"width", "height", "length", "maxheight", "maxwidth", "maxweight"} {
		if value, exists := tags[key]; exists && !isMeasurement(value) {
			return fail(422, "%s %d tag %s must be a non-negative number with an optional unit.", change.Type, change.ID, key)
		}
	}
	if value, exists := tags["building:levels"]; exists && !isNonNegativeNumber(value) {
		return fail(422, "%s %d tag building:levels must be a non-negative number.", change.Type, change.ID)
	}
	if value, exists := tags["lanes"]; exists {
		lanes, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || lanes < 1 {
			return fail(422, "%s %d tag lanes must be a positive integer.", change.Type, change.ID)
		}
	}
	if value, exists := tags["capacity"]; exists {
		capacity, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || capacity < 0 {
			return fail(422, "%s %d tag capacity must be a non-negative integer.", change.Type, change.ID)
		}
	}
	if value, exists := tags["maxspeed"]; exists && !isMaxspeed(value) {
		return fail(422, "%s %d tag maxspeed must be a number with an optional speed unit or a recognised special value.", change.Type, change.ID)
	}
	if value, exists := tags["email"]; exists {
		address, err := mail.ParseAddress(value)
		if err != nil || address.Address != value || !strings.Contains(value, "@") {
			return fail(422, "%s %d tag email is invalid.", change.Type, change.ID)
		}
	}
	if value, exists := tags["phone"]; exists && !isPhone(value) {
		return fail(422, "%s %d tag phone is invalid.", change.Type, change.ID)
	}
	if value, exists := tags["website"]; exists && !isWebsite(value) {
		return fail(422, "%s %d tag website must be a URL or domain name.", change.Type, change.ID)
	}
	if tags["boundary"] == "administrative" && tags["type"] == "boundary" {
		level, err := strconv.Atoi(tags["admin_level"])
		if err != nil || level < 1 || level > 11 {
			return fail(422, "%s %d administrative boundary requires admin_level from 1 to 11.", change.Type, change.ID)
		}
	}
	if tags["type"] == "route" && strings.TrimSpace(tags["route"]) == "" {
		return fail(422, "relation %d with type=route requires a route tag.", change.ID)
	}
	return nil
}

func validateSemanticGeometry(change normalizedChange) error {
	tags := change.Tags
	if (tags["type"] == "multipolygon" || tags["type"] == "route") && change.Type != "relation" {
		return fail(422, "%s %d tag type=%s is valid only on a relation.", change.Type, change.ID, tags["type"])
	}
	if change.Type == "relation" {
		return nil
	}
	if mustBeLine(tags) && change.Type != "way" {
		return fail(422, "%s %d uses a linear feature tag but is not a way.", change.Type, change.ID)
	}
	if mustBeArea(tags) {
		if change.Type != "way" || len(change.NodeRefs) < 4 || change.NodeRefs[0] != change.NodeRefs[len(change.NodeRefs)-1] {
			return fail(422, "%s %d uses an area feature tag but does not have a closed area geometry.", change.Type, change.ID)
		}
	}
	if change.Type == "way" && !isClosedWay(change.NodeRefs) && (tags["shop"] != "" || tags["tourism"] != "") {
		return fail(422, "Way %d with shop or tourism tags must be a closed area; use a node for a point feature.", change.ID)
	}
	return nil
}

func mustBeLine(tags map[string]string) bool {
	switch tags["waterway"] {
	case "river", "stream", "canal", "ditch", "drain", "tidal_channel":
		return true
	}
	switch tags["railway"] {
	case "rail", "tram", "subway", "light_rail", "monorail", "narrow_gauge":
		return true
	}
	switch tags["highway"] {
	case "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street", "track", "footway", "path", "cycleway", "bridleway", "steps", "pedestrian":
		return true
	default:
		return false
	}
}

func mustBeArea(tags map[string]string) bool {
	if tags["building"] != "" || tags["landuse"] != "" || tags["leisure"] == "park" || tags["natural"] == "water" {
		return true
	}
	return tags["area"] == "yes"
}

func isClosedWay(refs []int64) bool {
	return len(refs) >= 4 && refs[0] == refs[len(refs)-1]
}

func isYesNoUnknown(value string) bool {
	switch strings.TrimSpace(value) {
	case "yes", "no", "unknown", "1", "0", "true", "false":
		return true
	default:
		return false
	}
}

func isOneway(value string) bool {
	switch strings.TrimSpace(value) {
	case "yes", "no", "-1", "reversible", "alternating", "1", "0", "true", "false":
		return true
	default:
		return false
	}
}

func isMaxspeed(value string) bool {
	value = strings.TrimSpace(value)
	if maxspeedPattern.MatchString(value) || maxspeedCodePattern.MatchString(value) {
		return true
	}
	switch value {
	case "none", "walk", "signals", "variable", "implicit":
		return true
	default:
		return false
	}
}

func isMeasurement(value string) bool {
	value = strings.TrimSpace(value)
	return measurementPattern.MatchString(value) || feetInchesPattern.MatchString(value)
}

func isNonNegativeNumber(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	parsed, err := strconv.ParseFloat(strings.ReplaceAll(value, ",", "."), 64)
	return err == nil && parsed >= 0
}

func isPhone(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.ReplaceAll(value, "ext.", "x")
	value = strings.ReplaceAll(value, "ext", "x")
	value = strings.TrimPrefix(value, "tel:")
	return phonePattern.MatchString(value) && strings.ContainsAny(value, "0123456789")
}

func isWebsite(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || strings.IndexFunc(value, unicode.IsSpace) >= 0 {
		return false
	}
	value = strings.TrimPrefix(strings.TrimPrefix(value, "https://"), "http://")
	return strings.Contains(value, ".") && !strings.HasPrefix(value, ".") && !strings.HasSuffix(value, ".")
}
