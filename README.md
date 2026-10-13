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

## Dùng trên điện thoại cùng Wi-Fi

Giữ backend chạy ở cổng 4000. Frontend gọi `/api` trên cùng địa chỉ đang mở;
Next.js chuyển tiếp sang backend. Điện thoại chỉ cần truy cập cổng frontend,
không cần mở riêng cổng 4000 trong Windows Firewall.

Nếu frontend đang chạy, dừng bằng `Ctrl+C`. Trong thư mục `frontend`, chạy:

```powershell
npm.cmd run dev -- --hostname 0.0.0.0 --port 3000
```

Mở `http://<IPv4-Wi-Fi-của-máy-tính>:3000` trên điện thoại cùng mạng.
Dùng `ipconfig` để xem IPv4 hiện tại. Có thể thử `/api/products?limit=1`
ngay trên địa chỉ frontend để kiểm tra kết nối API.
Nếu IP Wi-Fi thay đổi, cập nhật `allowedDevOrigins` trong `frontend/next.config.ts`
bằng IP mới (không có `http://` hay cổng) rồi khởi động lại frontend dev.
Thiết lập này cho phép tài nguyên dev/HMR từ điện thoại, không thay thế backend.
Nếu không mở được cả trang, kiểm tra Wi-Fi và quyền inbound cổng frontend
trên mạng Private; không tắt toàn bộ firewall.

`frontend/.env.local` có thể đặt `BACKEND_API_URL=http://127.0.0.1:4000/api`.
Đây là địa chỉ **server Next.js truy cập**, không phải IP điện thoại.
Biến cũ `NEXT_PUBLIC_API_URL` không còn được sử dụng. Khi đổi đích backend,
khởi động lại dev server hoặc build lại bản production.

## Kiểm tra tốc độ và PWA

Để đo tốc độ, giữ backend và database chạy, dừng frontend dev ở cổng 3000
và chạy trong `frontend`:

```powershell
npm.cmd run build
npm.cmd run start -- --hostname 0.0.0.0 --port 3000
```

Chế độ dev biên dịch trang khi truy cập nên không phản ánh tốc độ production.
PWA/offline cần HTTPS được thiết bị tin cậy (hoặc localhost trên máy đang chạy).
HTTP qua IP LAN vẫn dùng được chức năng đặt món online nhưng không có service worker.
`?pwa=1` chỉ cho phép thử service worker trong dev trên secure context, không thay thế HTTPS.
Để thử PWA trên điện thoại, dùng HTTPS hợp lệ cho frontend; `/api` vẫn đi qua
frontend nên trình duyệt không gọi backend HTTP trực tiếp.

Sau khi cài bản HTTPS: mở app online một lần, chờ service worker sẵn sàng,
tắt mạng rồi tải lại để kiểm tra trang offline và bật mạng để thử kết nối lại.
Ứng dụng không tạo đơn hay thanh toán offline. Request quá 15 giây sẽ báo lỗi;
giao dịch chưa rõ kết quả giữ phiên để đối soát, không tự gửi lại thanh toán.

Kiểm tra chất lượng frontend: `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`.

## Quy ước

- Nhánh: `main` ← `develop` ← `feature/task-x-ten`. Không push thẳng `main`, `develop`.
- Commit: `feat:`, `fix:`, `docs:`, `chore:`.
- Mọi thay đổi qua Pull Request, cần 1 người review.
