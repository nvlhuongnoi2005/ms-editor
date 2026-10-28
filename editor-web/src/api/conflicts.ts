import { DATASET_NAME, parseFeature } from './graph';
import type { GraphFeature } from '../types/osm';

export interface EntitySnapshot {
  key: string;
  version: number;
  visible: boolean;
  feature: GraphFeature | null;
}
export interface SnapshotBatch { snapshots: EntitySnapshot[]; support: GraphFeature[] }

export async function loadEntitySnapshots(keys: string[]): Promise<SnapshotBatch> {
  if (!keys.length) return { snapshots: [], support: [] };
  const response = await fetch('/api/entities/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ dataset: DATASET_NAME, keys }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Không tải được bản server (${response.status}).`);
  if (!Array.isArray(payload?.snapshots) || !Array.isArray(payload?.support)) throw new Error('Snapshot server không hợp lệ.');
  const snapshots: EntitySnapshot[] = payload.snapshots.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Snapshot entity không hợp lệ.');
    const value = item as Record<string, unknown>;
    if (typeof value.key !== 'string' || typeof value.version !== 'number' || typeof value.visible !== 'boolean') throw new Error('Snapshot entity thiếu version/trạng thái.');
    const feature = value.visible ? parseFeature(value.feature) : null;
    if (feature && (`${feature.properties.entityType}/${feature.properties.entityId}` !== value.key || feature.properties.version !== value.version)) throw new Error('Snapshot entity không khớp ID/version.');
    return { key: value.key, version: value.version, visible: value.visible, feature };
  });
  if (snapshots.length !== keys.length || new Set(snapshots.map(item => item.key)).size !== keys.length || keys.some(key => !snapshots.some(item => item.key === key))) throw new Error('Server trả thiếu snapshot cần giải quyết.');
  return { snapshots, support: payload.support.map(parseFeature) };
}
