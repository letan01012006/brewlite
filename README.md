# BrewLite

Ứng dụng đặt cà phê không dùng tiền mặt. NestJS + Next.js + PostgreSQL (Prisma).

## Yêu cầu

Node.js 24.15+ (hoặc 26), Git, Docker Desktop.

Các lệnh dưới đây dùng PowerShell trên Windows. Trên macOS/Linux, dùng `npm`,
`npx` thay cho `npm.cmd`, `npx.cmd` và `cp` thay cho `Copy-Item`.
Mở Docker Desktop và chờ Docker Engine sẵn sàng trước khi chạy database.

## Chạy lần đầu sau khi clone

### 1. Tải mã nguồn và khởi động database

```powershell
git clone https://github.com/letan01012006/brewlite.git
cd brewlite
docker compose up -d
```

Docker Compose của dự án chỉ chạy PostgreSQL ở cổng **5432**.
Backend và frontend cần chạy riêng ở hai terminal bên dưới.
Lần đầu Docker có thể mất thêm thời gian tải image. Kiểm tra database sẵn sàng:

```powershell
docker compose exec db pg_isready -U brewlite -d brewlite
```

Chờ kết quả `accepting connections` rồi tiếp tục.

### 2. Cài đặt và chạy backend — terminal thứ nhất

Từ thư mục gốc `brewlite`:

```powershell
cd backend
Copy-Item .env.example .env
npm.cmd ci
```

Mở `backend/.env`, thay `JWT_SECRET="change-me"` bằng chuỗi bí mật ngẫu nhiên
của bạn. Giữ `DATABASE_URL` theo mẫu nếu dùng PostgreSQL từ Docker Compose
của dự án. Không đưa file `.env` lên GitHub.

Sau đó chạy trong cùng terminal:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate deploy
npx.cmd prisma db seed
npm.cmd run start:dev
```

Các lệnh Prisma lần lượt tạo client, tạo/cập nhật cấu trúc database và thêm
dữ liệu demo. Giữ terminal này chạy. Tài liệu API: <http://localhost:4000/api/docs>.

### 3. Cài đặt và chạy frontend — terminal thứ hai

Mở terminal mới tại thư mục gốc `brewlite`:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm.cmd ci
npm.cmd run dev -- --port 3000
```

Giữ terminal này chạy và mở <http://localhost:3000>.
File `frontend/.env.local` dùng `BACKEND_API_URL=http://127.0.0.1:4000/api`
để Next.js chuyển tiếp request đến backend.

### Tài khoản demo

Sau khi seed database mới, có thể đăng nhập bằng:

| Vai trò | Email | Mật khẩu |
| --- | --- | --- |
| Khách hàng | `demo@brewlite.com` | `Demo@1234` |
| Barista | `barista@brewlite.com` | `Barista@123` |

Các tài khoản này chỉ dùng để thử dự án ở môi trường local.

## Những lần chạy tiếp theo

Mở Docker Desktop. Từ thư mục gốc `brewlite`, khởi động database:

```powershell
docker compose up -d
```

**Terminal thứ nhất**, bắt đầu tại thư mục gốc `brewlite`:

```powershell
cd backend
npm.cmd run start:dev
```

**Terminal thứ hai**, cũng bắt đầu tại thư mục gốc `brewlite`:

```powershell
cd frontend
npm.cmd run dev -- --port 3000
```

Mở <http://localhost:3000>. Nếu terminal đã ở `backend` hoặc `frontend`,
bỏ qua lệnh `cd` tương ứng. Không cần copy lại `.env`, cài thư viện,
generate Prisma, migrate hay seed mỗi lần mở dự án khi mã nguồn không đổi.

### Khi vừa kéo mã nguồn mới từ GitHub

Nếu dependencies hoặc lockfile thay đổi, chạy `npm.cmd ci` trong thư mục
`backend` hoặc `frontend` tương ứng. Nếu Prisma schema hoặc migrations thay đổi,
chạy trong `backend` khi database đang hoạt động:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate deploy
```

Nếu `.env.example` có biến mới, bổ sung vào file môi trường đang dùng;
không copy đè làm mất cấu hình riêng. Chỉ seed lại khi cần bổ sung dữ liệu demo.
Khởi động lại server sau khi cập nhật.

### Dừng dự án

Nhấn `Ctrl+C` trong từng terminal frontend và backend.
Từ thư mục gốc `brewlite`, dừng database:

```powershell
docker compose stop
```

Lệnh này giữ lại dữ liệu cho lần chạy sau. `docker compose down -v` sẽ xóa
volume database, vì vậy không dùng lệnh đó để dừng dự án hằng ngày.

### Lỗi khởi động thường gặp

- **Cổng 3000 đang được sử dụng:** dừng server hoặc container đang chiếm cổng
  rồi chạy lại frontend. Xóa Docker image không giải phóng cổng của tiến trình đang chạy.
- **`ECONNREFUSED 127.0.0.1:4000`:** frontend chưa kết nối được backend.
  Kiểm tra terminal backend đã khởi động thành công ở cổng 4000 và database đang chạy.
- **Không kết nối được database:** kiểm tra Docker Desktop, `docker compose ps`
  và `DATABASE_URL` trong `backend/.env`.

## Website trên trình duyệt

BrewLite ưu tiên trình duyệt máy tính, giữ giao diện responsive khi thu nhỏ cửa sổ.
Điều hướng chính và giỏ hàng nằm ở header; không còn thanh điều hướng đáy,
giỏ hàng nổi, manifest, banner cài ứng dụng hoặc chế độ PWA.

Frontend gọi `/api` cùng origin; Next.js chuyển tiếp đến `BACKEND_API_URL`
(mặc định `http://127.0.0.1:4000/api`). Đây là địa chỉ server Next.js truy cập.
Giữ backend và database chạy để dùng đăng nhập, menu, giỏ hàng và thanh toán.
Không cần IP LAN hardcode để chạy local. Khi đổi đích backend, khởi động lại
server hoặc build lại production. `NEXT_PUBLIC_API_URL` không được sử dụng.

Để kiểm tra bản production, dừng frontend dev ở cổng 3000 rồi chạy trong `frontend`:

```powershell
npm.cmd run build
npm.cmd run start -- --port 3000
```

Mở <http://localhost:3000>. Chế độ dev biên dịch khi truy cập nên không phản ánh
tốc độ production. Website cần mạng để tải trang/API, tạo đơn và thanh toán.
Request quá 15 giây báo lỗi; checkout chưa rõ kết quả vẫn giữ phiên để đối soát,
không tự gửi lại thanh toán. Các kiểm tra mất mạng của API/auth/cart/checkout
vẫn được giữ lại.

### Trình duyệt từng chạy PWA

Website không đăng ký service worker mới. Cleanup trong root layout chỉ gỡ worker
có script URL chính xác `/sw.js` cùng origin và scope `/`; bỏ qua registration
có worker khác đang active/waiting/installing. Chỉ cache có tiền tố `brewlite-pwa-`
bị xóa. Không sửa localStorage, sessionStorage, cookie, tài khoản, giỏ hàng, theme
hoặc phiên checkout và không tự reload/chuyển trang.

Tạm giữ `frontend/public/sw.js` tại URL cũ với header không cache. Trình duyệt còn
registration cũ có thể lấy bản worker vô hiệu hóa này khi kiểm tra cập nhật:
worker kích hoạt ngay, dọn đúng cache BrewLite, nhận quyền điều khiển tab rồi tự
gỡ đăng ký. Worker không xử lý fetch, precache hoặc điều hướng tab. Nếu cleanup
trên trang gỡ registration trước, worker đang điều khiển tab có thể còn sống đến
lần điều hướng/đóng tab tự nhiên; không ép tải lại giữa lúc checkout.

Giữ `/sw.js` trong giai đoạn chuyển đổi để cả trình duyệt lâu không truy cập có
cơ hội cập nhật. Chỉ xóa file và header `/sw.js` khi đã xác nhận các profile cũ
được chuyển đổi hoặc chấp nhận kết thúc hỗ trợ chúng; không có thời hạn tự động
đảm bảo mọi profile đã quay lại. Có thể giữ component cleanup lâu hơn để dọn
cache còn sót. Xem `frontend/test/README.md` để kiểm tra profile cũ và dữ liệu giữ lại.

### Kiểm tra frontend

Chạy trong `frontend`:

```powershell
npm.cmd run lint
npm.cmd test
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
```

Kiểm tra giao diện light/dark ở 1440px, 1024px và khoảng 390px; thử điều hướng,
modal bằng bàn phím/Escape, giỏ hàng và checkout. Test tự động không thay thế
kiểm tra giao diện và các luồng với backend thật.

## Quy ước

- Nhánh: `main` ← `develop` ← `feature/task-x-ten`. Không push thẳng `main`, `develop`.
- Commit: `feat:`, `fix:`, `docs:`, `chore:`.
- Mọi thay đổi qua Pull Request, cần 1 người review.
