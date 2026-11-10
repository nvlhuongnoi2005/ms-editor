package enc

import (
	"archive/zip"
	"fmt"
	"os"
	archivepath "path"
	"strconv"
	"strings"
)

// Validate directory invariants before creating an import job. GDAL validates S-57 content.
func validateArchiveDirectory(entries []*zip.File) error {
	paths := map[string]bool{}
	chains := map[string]map[int]bool{}
	folders := map[string]string{}
	var unpacked uint64
	if len(entries) > 100000 {
		return fmt.Errorf("ENC ZIP exceeds 100,000 entries.")
	}
	for _, entry := range entries {
		if entry.Flags&1 != 0 {
			return fmt.Errorf("Password-protected ZIP is not supported.")
		}
		if entry.Method != zip.Store && entry.Method != zip.Deflate {
			return fmt.Errorf("ZIP compression must be Store or Deflate.")
		}
		if entry.UncompressedSize64 > (2<<30)-unpacked {
			return fmt.Errorf("ENC ZIP exceeds 2 GiB unpacked.")
		}
		unpacked += entry.UncompressedSize64
		path := strings.ReplaceAll(entry.Name, "\\", "/")
		if strings.HasPrefix(path, "/") || strings.Contains(path, ":") || strings.ContainsRune(path, 0) || strings.Contains("/"+path+"/", "/../") || entry.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("ENC ZIP contains unsafe paths.")
		}
		normalized := strings.ToLower(archivepath.Clean(path))
		if paths[normalized] {
			return fmt.Errorf("ENC ZIP contains duplicate paths.")
		}
		paths[normalized] = true
		ext := archivepath.Ext(normalized)
		if len(ext) != 4 {
			continue
		}
		version, err := strconv.Atoi(ext[1:])
		if err != nil || version < 0 || version > 999 {
			continue
		}
		stem := strings.TrimSuffix(archivepath.Base(normalized), ext)
		if stem == "catalog" {
			continue
		}
		folder := archivepath.Dir(normalized)
		if chains[stem] == nil {
			chains[stem] = map[int]bool{}
			folders[stem] = folder
		}
		if folders[stem] != folder || chains[stem][version] {
			return fmt.Errorf("Cell %s is duplicated or its updates are in another directory.", strings.ToUpper(stem))
		}
		chains[stem][version] = true
	}
	for name, versions := range chains {
		if !versions[0] {
			return fmt.Errorf("Cell %s has updates but no .000 base.", strings.ToUpper(name))
		}
		for i := 0; i < len(versions); i++ {
			if !versions[i] {
				return fmt.Errorf("Cell %s has a missing update.", strings.ToUpper(name))
			}
		}
	}
	return nil
}
