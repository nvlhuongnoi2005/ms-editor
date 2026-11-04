"""Generate a tiny real PBF for import tests; no network or user dataset needed."""
import argparse
from pathlib import Path
import osmium

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()

with osmium.SimpleWriter(str(args.output)) as writer:
    class Copy(osmium.SimpleHandler):
        def node(self, obj): writer.add_node(obj)
        def way(self, obj): writer.add_way(obj)
        def relation(self, obj): writer.add_relation(obj)
    Copy().apply_file(str(Path(__file__).with_name("small.osm")))
