"""Check a fresh isolated installation, including real upload workers.

Developer tool; requires Python only on the verification machine.
Never point it at an installation containing user datasets.
Pass --enc to exercise a supplied .000 without including that data in releases.
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--osm-image", default="ms-editor/osm-worker:local")
    parser.add_argument("--enc", type=Path)
    parser.add_argument("--enc-name", default="V14S0069.000")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    if urllib.parse.urlparse(base).hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("Only an isolated local installation may be tested.")

    def request(path: str, body: bytes | None = None, headers=None) -> bytes:
        req = urllib.request.Request(base + path, body, headers or {})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{path}: {error.code}: {error.read().decode()}") from error

    def get(path: str):
        return json.loads(request(path))

    for path in ("/api/datasets", "/api/enc/datasets"):
        assert not get(path)["datasets"], "Smoke checks require an empty installation."
    assert get("/api/imports")["workerOnline"], "OSM import consumer is offline."
    tilejson = get("/datas/satellite2.json")
    assert all(url.startswith(base + "/datas/") for url in tilejson["tiles"])
    print("PASS empty OSM/ENC databases, OSM worker and same-origin basemap", flush=True)

    def upload(name: str, filename: str, content: bytes):
        boundary = "smoke-" + uuid.uuid4().hex
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        return json.loads(request("/api/uploads?dataset=" + name, body, {
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "X-Editor-Import": "1", "Origin": base,
        }))

    def wait_for(path: str, key: str, identity: str):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            entries = get(path)[key]
            item = next((row for row in entries if row["id"] == identity), None)
            if item and item["state"] == "failed":
                raise AssertionError(item)
            if item and item["state"] == "ready":
                return item
            time.sleep(1)
        raise TimeoutError(f"Import did not complete: {identity}")

    # Generate a tiny PBF using the packaged GIS dependency, without pulling an
    # image or shipping a source dataset with the software.
    pbf = subprocess.check_output([
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "python",
        args.osm_image, "-c",
        "import osmium,sys; from osmium.osm.mutable import Node,Way;"
        " w=osmium.SimpleWriter('/tmp/smoke.osm.pbf');"
        " coords=[(105.8,21.0),(105.801,21.0),(105.801,21.001),(105.8,21.001)];"
        " [w.add_node(Node(id=i+1,version=1,location=p)) for i,p in enumerate(coords)];"
        " w.add_way(Way(id=10,version=1,nodes=[1,2,3,4,1],tags={'building':'yes','name':'Smoke building'}));"
        " w.close(); sys.stdout.buffer.write(open('/tmp/smoke.osm.pbf','rb').read())",
    ])
    suffix = uuid.uuid4().hex[:8]
    name = "smoke-osm-" + suffix
    job = upload(name, "smoke.osm.pbf", pbf)
    result = wait_for("/api/imports", "jobs", job["id"])
    assert result["nodes"] == 4 and result["ways"] == 1, result
    query = urllib.parse.urlencode({"dataset": name, "bbox": "105.799,20.999,105.802,21.002", "zoom": 18})
    graph = get("/api/graph?" + query)
    assert graph["features"], graph
    print("PASS PBF upload, canonical/render import and graph API", flush=True)

    if args.enc:
        cell = args.enc.read_bytes()
        job = upload("smoke-enc-" + suffix, args.enc_name, cell)
        result = wait_for("/api/enc/datasets", "datasets", job["id"])
        assert result["featureCount"] > 0, result
        print(f"PASS direct .000 upload: {result['featureCount']} objects", flush=True)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr(args.enc_name, cell)
        job = upload("smoke-zip-" + suffix, "smoke.zip", archive.getvalue())
        result = wait_for("/api/enc/datasets", "datasets", job["id"])
        assert result["outcomes"].get("duplicate") == 1, result
        print("PASS ENC ZIP upload and reuse of duplicate cell revision", flush=True)


if __name__ == "__main__":
    main()
