import type { EncEditFeature } from './editing';

const messages:Record<string,string>={
  sounding_group:'Điểm đo sâu thuộc nhóm SOUNDG. Cần biên tập cả nhóm và giữ giá trị độ sâu.',
  metadata_class:'Lớp metadata được bảo vệ, không hỗ trợ kéo vị trí.',
  point_dimensions:'Điểm không phải tọa độ 2D độc lập; cần giữ chiều sâu hoặc cấu trúc nguồn.',
  unsupported_class:'Lớp này chưa hỗ trợ di chuyển điểm.',
  unsupported_geometry:'Kiểu hình học này chưa hỗ trợ di chuyển trong bộ biên tập cơ bản.',
  connected_node:'Điểm tham chiếu ConnectedNode, có thể là đầu mút của cạnh. Cần biên tập topology liên quan.',
  isolated_node_unverified:'Chưa xác nhận được một IsolatedNode riêng từ tham chiếu primitive nguồn.',
  feature_links:'Đối tượng có tham chiếu dùng chung hoặc liên kết với đối tượng khác. Cần kiểm tra nhóm liên quan trước khi di chuyển.',
  edge_ownership_unverified:'Chưa xác nhận được toàn bộ cạnh và nút đầu mút thuộc riêng đối tượng; có thể thiếu primitive, dùng chung đầu mút hoặc cell có Face.',
};
export function movementLockMessage(feature:Pick<EncEditFeature,'canMove'|'moveLockReason'>):string|undefined {
  return feature.canMove?undefined:messages[feature.moveLockReason??'']??'Chưa xác nhận được quyền di chuyển độc lập từ dữ liệu nguồn.';
}

export function withSourcePermissions(feature:EncEditFeature,source:EncEditFeature):EncEditFeature {
  const canMove=source.canMove||Boolean(feature.positionOverride&&source.canOverridePosition);
  const moveLockReason=canMove?undefined:source.moveLockReason;
  if(feature.canMove===canMove&&feature.canDelete===source.canDelete&&feature.canOverridePosition===source.canOverridePosition&&feature.moveLockReason===moveLockReason)return feature;
  return {...feature,canMove,canDelete:source.canDelete,canOverridePosition:source.canOverridePosition,moveLockReason};
}
