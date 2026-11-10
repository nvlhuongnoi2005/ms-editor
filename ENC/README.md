# ENC domain

`ENC/` chứa tài sản và hợp đồng riêng cho luồng Electronic Navigational Chart.
Nó không dùng model node/way/relation, importer hoặc renderer của OSM.

## Preview hiện tại

Mở `http://localhost:5173/?mode=enc` khi chạy frontend development, hoặc
`http://localhost:4173/?mode=enc` khi chạy bản build. Preview dùng vector tile
công khai của OpenENC chỉ để kiểm tra MapLibre, layer order và presentation.
Sprite được phục vụ từ các file trong `sprites/` qua `/enc/assets/sprites/...`.

Preview không đọc, gửi hoặc import `OneWeek_ENCs.zip`. ZIP này là fixture cho
ENC importer sau này: importer sẽ giải nén, nhận các base cell `.000`, áp dụng
chuỗi update `.001...` theo từng cell và đưa dữ liệu vào ENC Canonical DB.

## Ownership

```text
ENC/
  sprites/       MapLibre sprite atlases theo day/dusk/night
  styles/        profile và rule ENC do hệ thống sở hữu (bước kế tiếp)
  importer/      GDAL worker, cell/update validation (bước kế tiếp)
  render/        symbology và MVT worker (bước kế tiếp)
```

Mã OSM hiện tại tiếp tục ở `canonical-importer/`, `editor-api/` và
`editor-web/src/features/{editor,map}`. Khi có ENC canonical/API contract,
code ENC frontend sẽ phát triển dưới `editor-web/src/domains/enc`; code dùng
chung chỉ đặt ở các module `shared` được xác định rõ, không chia sẻ model OSM.
