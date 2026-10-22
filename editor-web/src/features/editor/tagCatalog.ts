export interface OsmTagOption {
  key: string;
  label: string;
  description: string;
  defaultValue?: string;
}

// A curated, Vietnamese-labelled subset of common OSM keys. OSM permits
// additional valid keys, so the editor keeps free-text entry as a fallback.
export const OSM_TAG_OPTIONS: OsmTagOption[] = [
  { key: 'name', label: 'Tên', description: 'Tên chính thức hoặc tên thông dụng' },
  { key: 'alt_name', label: 'Tên khác', description: 'Tên thay thế' },
  { key: 'operator', label: 'Tổ chức chủ quản', description: 'Đơn vị vận hành hoặc quản lý' },
  { key: 'website', label: 'Trang web', description: 'URL trang web' },
  { key: 'phone', label: 'Điện thoại', description: 'Số điện thoại liên hệ' },
  { key: 'email', label: 'Email', description: 'Địa chỉ email liên hệ' },
  { key: 'opening_hours', label: 'Giờ mở cửa', description: 'Định dạng opening_hours của OSM' },
  { key: 'wheelchair', label: 'Đi xe lăn được', description: 'Khả năng tiếp cận xe lăn', defaultValue: 'yes' },
  { key: 'fee', label: 'Phí', description: 'Có thu phí hay không', defaultValue: 'no' },
  { key: 'internet_access', label: 'Kết nối Internet', description: 'Khả năng truy cập Internet', defaultValue: 'wlan' },
  { key: 'capacity', label: 'Sức chứa', description: 'Số người, xe hoặc chỗ chứa tối đa' },
  { key: 'addr:housenumber', label: 'Số nhà', description: 'Địa chỉ: số nhà' },
  { key: 'addr:street', label: 'Đường', description: 'Địa chỉ: tên đường' },
  { key: 'addr:ward', label: 'Phường/Xã/Thị trấn', description: 'Địa chỉ: đơn vị hành chính cấp cơ sở' },
  { key: 'addr:city', label: 'Thành phố/Thị xã', description: 'Địa chỉ: thành phố hoặc thị xã' },
  { key: 'addr:postcode', label: 'Mã bưu chính', description: 'Địa chỉ: mã bưu chính' },
  { key: 'highway', label: 'Loại đường', description: 'Phân loại đường hoặc lối đi' },
  { key: 'surface', label: 'Mặt đường', description: 'Vật liệu bề mặt' },
  { key: 'maxspeed', label: 'Tốc độ tối đa', description: 'Giới hạn tốc độ, ví dụ 50' },
  { key: 'oneway', label: 'Một chiều', description: 'Hướng lưu thông một chiều', defaultValue: 'yes' },
  { key: 'lanes', label: 'Số làn', description: 'Số làn xe' },
  { key: 'sidewalk', label: 'Vỉa hè', description: 'Vỉa hè dọc đường', defaultValue: 'both' },
  { key: 'building', label: 'Tòa nhà', description: 'Loại công trình', defaultValue: 'yes' },
  { key: 'amenity', label: 'Tiện ích', description: 'Trường học, bệnh viện, nhà vệ sinh…' },
  { key: 'shop', label: 'Cửa hàng', description: 'Loại cửa hàng' },
  { key: 'tourism', label: 'Du lịch', description: 'Điểm lưu trú hoặc du lịch' },
  { key: 'leisure', label: 'Giải trí', description: 'Công viên, sân chơi, thể thao…' },
  { key: 'natural', label: 'Tự nhiên', description: 'Đối tượng tự nhiên' },
  { key: 'water', label: 'Loại vùng nước', description: 'Ao, hồ, bể nước…' },
  { key: 'landuse', label: 'Sử dụng đất', description: 'Rừng, đất ở, đất nông nghiệp…' },
  { key: 'religion', label: 'Tôn giáo', description: 'Tôn giáo liên quan' },
  { key: 'denomination', label: 'Giáo phái', description: 'Giáo phái hoặc hệ phái' }
];
