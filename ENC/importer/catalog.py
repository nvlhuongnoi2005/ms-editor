"""Read cell descriptions from ISO 8211 CATALOG.031; no external text is executed."""
import re


def catalog_descriptions(data: bytes) -> dict[str, str]:
    descriptions = {}
    offset = 0
    while offset + 24 <= len(data):
        leader = data[offset:offset + 24]
        try:
            length, start = int(leader[:5]), int(leader[12:17])
            length_size, position_size, tag_size = int(leader[20:21]), int(leader[21:22]), int(leader[23:24])
            width = length_size + position_size + tag_size
            if length < 24 or start < 25 or start > length or width == 0 or offset + length > len(data):
                break
            record = data[offset:offset + length]
            if leader[6:7] != b'L':
                for index in range(24, start - 1, width):
                    entry = record[index:index + width]
                    if entry[:tag_size] != b'CATD':
                        continue
                    size = int(entry[tag_size:tag_size + length_size])
                    position = int(entry[tag_size + length_size:])
                    fields = record[start + position:start + position + size].rstrip(b'\x1e').split(b'\x1f')
                    if len(fields) < 2:
                        continue
                    # CATD's first subfield includes fixed RCNM/RCID followed by FILE.
                    match = re.search(rb'([A-Za-z0-9_-]+)\.000$', fields[0], re.I)
                    if match and fields[1].strip():
                        try:
                            label = fields[1].decode('utf-8')
                        except UnicodeDecodeError:
                            label = fields[1].decode('latin1')
                        descriptions[match[1].decode('ascii').upper()] = label.strip()
        except (ValueError, IndexError):
            break
        offset += length
    return descriptions
