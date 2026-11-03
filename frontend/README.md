# BrewLite frontend

Website Next.js 16.4.0 / React 19, ưu tiên trình duyệt máy tính và responsive cơ bản.
Giữ màu thương hiệu, light/dark mode và các luồng đặt món hiện có. Không còn PWA,
manifest, cài app, offline page, bottom navigation hoặc giỏ hàng nổi.

## Chạy local

Khởi động backend ở cổng 4000 và database theo `../README.md`. Trong `frontend`:

```powershell
npm.cmd ci
npm.cmd run dev -- --port 3000
```

Mở <http://localhost:3000>. Nếu chưa cấu hình môi trường, copy `.env.example`
sang `.env.local` theo README gốc. Không ghi đè cấu hình đang có.
`/api/:path*` được Next.js chuyển tiếp tới `BACKEND_API_URL`, mặc định
`http://127.0.0.1:4000/api`. Trình duyệt chỉ gọi frontend cùng origin.
Không có cấu hình IP LAN hardcode. Trên macOS/Linux dùng `npm`/`npx`.

## Kiểm tra và chạy production

```powershell
npm.cmd run lint
npm.cmd test
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
npm.cmd run start -- --port 3000
```

Dừng dev server trước khi chạy production trên cùng cổng. Font Inter và Geist
Mono vẫn dùng `next/font/google`; build cần truy cập nguồn font hoặc cache hợp lệ.
Hướng dẫn test và giới hạn môi trường nằm trong `test/README.md`.

## Chuyển đổi từ PWA

`LegacyPwaCleanup` chạy khi root layout mount, không có UI. Nó chỉ unregister
registration có script URL `/sw.js` cùng origin, scope `/`, không chứa worker
khác; chỉ xóa Cache Storage `brewlite-pwa-*`. Không xóa localStorage,
sessionStorage, cookie hoặc reload trang. Mỗi API cleanup được xử lý độc lập
khi trình duyệt từ chối truy cập; lần mở trang sau sẽ thử lại.

`public/sw.js` tạm giữ ở URL cũ với `Cache-Control: no-cache, no-store,
must-revalidate` để registration cũ nhận bản vô hiệu hóa qua update check của
trình duyệt. Worker dùng `skipWaiting`, dọn cache BrewLite, `clients.claim` rồi
tự unregister, không có fetch handler và không điều hướng tab. Component không
đăng ký worker này. Worker cũ đang điều khiển tab có thể tồn tại tới lần điều
hướng/đóng tab tự nhiên nếu component unregister trước; không ép reload checkout.

Chỉ xóa `public/sw.js` cùng header tương ứng khi đã xác nhận profile cũ được
chuyển đổi hoặc quyết định kết thúc thời gian hỗ trợ profile lâu không quay lại.
Không có mốc thời gian tự động đảm bảo mọi trình duyệt đã cập nhật. Component
cleanup có thể giữ lâu hơn để dọn registration/cache còn sót.

Website cần mạng cho trang/API và thanh toán. Khôi phục checkout, chống thanh
toán lặp và xử lý lỗi mạng vẫn thuộc luồng web và được giữ nguyên.
