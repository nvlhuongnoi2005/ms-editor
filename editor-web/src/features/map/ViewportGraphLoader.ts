import type { GraphPart } from '../../api/graph';
import type { GraphFeature, GraphResponse } from '../../types/osm';

type Bbox = [number, number, number, number];
interface Entry {
  bbox: Bbox;
  features: GraphFeature[];
  revision: number;
  complete: boolean;
}
interface Request {
  bbox: Bbox;
  controller: AbortController;
  promise: Promise<void>;
}
interface Options {
  load: (bbox: Bbox, signal: AbortSignal, part: GraphPart) => Promise<GraphResponse>;
  onFeatures: (features: GraphFeature[]) => void;
  onRelations: (features: GraphFeature[]) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
}

function contains(outer: Bbox, inner: Bbox) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function buffered([west, south, east, north]: Bbox): Bbox {
  const dx = (east - west) * 0.18, dy = (north - south) * 0.18;
  return [Math.max(-180, west - dx), Math.max(-85.051129, south - dy), Math.min(180, east + dx), Math.min(85.051129, north + dy)];
}

// Geometry is interactive before relations arrive. One owner coordinates cache,
// cancellation and hydration so stale requests cannot replace a newer viewport.
export class ViewportGraphLoader {
  private cache = new Map<string, Entry>();
  private active: Request | null = null;
  private displayed: GraphFeature[] | null = null;

  constructor(private options: Options) {}

  cancel() {
    this.active?.controller.abort();
    this.active = null;
    this.options.onLoading(false);
  }

  invalidate() {
    this.cancel();
    this.cache.clear();
    this.displayed = null;
  }

  private show(features: GraphFeature[]) {
    if (features === this.displayed) return;
    this.displayed = features;
    this.options.onFeatures(features);
  }

  refresh(viewport: Bbox): Promise<void> {
    const cached = [...this.cache.values()].reverse().find(entry => contains(entry.bbox, viewport));
    if (cached?.complete) {
      this.cancel();
      this.show(cached.features);
      this.options.onError(null);
      return Promise.resolve();
    }
    if (this.active && contains(this.active.bbox, viewport)) return this.active.promise;
    this.cancel();
    const bbox = cached?.bbox ?? buffered(viewport);
    const request: Request = { bbox, controller: new AbortController(), promise: Promise.resolve() };
    this.active = request;
    this.options.onError(null);
    if (cached) this.show(cached.features);
    this.options.onLoading(!cached);
    const current = () => this.active === request && !request.controller.signal.aborted;
    request.promise = (async () => {
      let entry = cached;
      try {
        if (!entry) {
          const geometry = await this.options.load(bbox, request.controller.signal, 'geometry');
          if (!current()) return;
          entry = { bbox, features: geometry.features, revision: geometry.canonicalRevision, complete: false };
          this.cache.set(bbox.join(','), entry);
          if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
          this.show(entry.features);
          this.options.onLoading(false);
        }
        const relations = await this.options.load(bbox, request.controller.signal, 'relations');
        if (!current()) return;
        if (relations.canonicalRevision !== entry.revision) {
          // Never silently combine geometry and relations from different revisions.
          this.cache.delete(bbox.join(','));
          this.options.onError('Dữ liệu server đã thay đổi trong lúc tải. Di chuyển bản đồ để tải lại.');
          return;
        }
        if (relations.features.length) {
          entry.features = [...entry.features, ...relations.features];
          // Append only new relations; don't clone/hydrate the geometry again.
          this.options.onRelations(relations.features);
        }
        entry.complete = true;
        this.displayed = entry.features;
      } catch (reason) {
        if (current()) {
          const message = reason instanceof Error ? reason.message : 'Không thể tải dữ liệu bản đồ.';
          this.options.onError(entry ? `Đã tải đường/điểm nhưng chưa tải được relation: ${message}` : message);
        }
      } finally {
        if (current()) {
          this.active = null;
          this.options.onLoading(false);
        }
      }
    })();
    return request.promise;
  }
}
