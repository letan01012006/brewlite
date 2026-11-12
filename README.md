# BrewLite

Ứng dụng đặt cà phê với giỏ hàng, voucher, điểm thưởng, thanh toán VNPAY và quản lý nguyên liệu.
Xây dựng bằng **Next.js, NestJS và PostgreSQL (Prisma)**.

## Chạy bằng Docker

Cần Git và Docker Desktop đang hoạt động. Từ thư mục gốc, tạo cấu hình nếu chưa có:

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Cập nhật `backend/.env` trước khi chạy:

| Cấu hình | Yêu cầu |
| --- | --- |
| `DATABASE_URL` | Giữ URL database hiện có; database mới dùng `brewlite` theo file mẫu. |
| `JWT_SECRET`, `OTP_HASH_SECRET` | Dùng hai khóa riêng; khóa OTP dài ít nhất 32 ký tự. |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | Điền thông tin merchant để thanh toán VNPAY; giá trị mẫu trả lỗi 503. |
| `SMS_PROVIDER`, `ESMS_*` | SMS thật dùng `esms`, hai key eSMS, Brandname và mẫu được duyệt chứa `{OTP}`. |
| `AUTH_OTP_DEMO` | Demo offline: `SMS_PROVIDER=local`, `AUTH_OTP_DEMO=true` trong development/test; OTP là `123456`. |

Toàn bộ biến môi trường nằm trong [backend/.env.example](backend/.env.example). Giữ file `.env` ngoài Git.

```powershell
docker compose up --build
```

| Thành phần | Địa chỉ |
| --- | --- |
| Website | http://localhost:3000 |
| Swagger | http://localhost:4000/api/docs |
| Backend health | http://localhost:4000/api/health |
| PostgreSQL | localhost:5432 |

Backend chờ database sẵn sàng rồi tự chạy `prisma migrate deploy`. Compose dùng lại
volume **`brewlite_pgdata`**, giữ database trong `.env` và chỉ đổi host/port thành `db:5432`.
Dữ liệu không được seed tự động.

```powershell
docker compose ps              # Xem trạng thái
docker compose logs backend    # Xem log
docker compose stop            # Dừng và giữ dữ liệu
```

Sửa code rồi chạy lại `docker compose up --build`. Sau khi đổi `.env`, dùng
`docker compose up -d --force-recreate backend`. Tránh `docker compose down -v` vì lệnh này xóa volume database.

## Phát triển trên máy

Cần Node.js 24.15+ hoặc 26. Các lệnh dưới đây dùng PowerShell; trên macOS/Linux,
dùng `npm`, `npx` thay cho `npm.cmd`, `npx.cmd`. Dừng container frontend/backend
nếu đang dùng cùng cổng, rồi khởi động database:

```powershell
docker compose stop frontend backend
docker compose up -d --wait db
```

Đảm bảo `backend/.env` đã cấu hình như trên. Chạy backend ở terminal thứ nhất:

```powershell
cd backend
npm.cmd ci
npx.cmd prisma generate
npx.cmd prisma migrate deploy
npm.cmd run start:dev
```

Chạy frontend ở terminal thứ hai, bắt đầu từ thư mục gốc:

```powershell
cd frontend
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm.cmd ci
npm.cmd run dev -- --port 3000
```

Frontend gọi `/api` cùng origin; Next.js chuyển tiếp đến `BACKEND_API_URL`
(mặc định khi chạy trên máy: `http://127.0.0.1:4000/api`).
Những lần chạy sau chỉ cần bật database và chạy hai lệnh dev; cài lại dependencies
khi lockfile đổi, generate/migrate khi Prisma thay đổi.

## Dữ liệu demo

Nếu cần dữ liệu mẫu, chạy `npx.cmd prisma db seed` trong `backend`,
hoặc `docker compose run --rm backend npx prisma db seed` từ thư mục gốc.

| Vai trò | Email | Mật khẩu local |
| --- | --- | --- |
| Khách hàng | `demo@brewlite.com` | `Demo@1234` |
| Barista | `barista@brewlite.com` | `Barista@123` |

## Kiểm thử

Chạy trong thư mục tương ứng:

| Thư mục | Lệnh |
| --- | --- |
| `backend` | `npm.cmd test` · `npm.cmd run test:e2e` · `npm.cmd run lint` · `npx.cmd tsc --noEmit` |
| `frontend` | `npm.cmd test` · `npm.cmd run lint` · `npx.cmd tsc --noEmit --incremental false` · `npm.cmd run build` |

Test E2E cần `TEST_DATABASE_URL` trỏ tới database kiểm thử **khác** `DATABASE_URL`;
eSMS được giả lập, không gửi SMS thật. Kiểm tra dữ liệu Compose trước/sau khi
khởi động bằng `node scripts/compose-smoke.mjs baseline` và `node scripts/compose-smoke.mjs verify`.

Test OTP thật qua Swagger: `POST /api/auth/register` hoặc `POST /api/auth/resend-otp`,
sau đó nhập mã SMS vào `POST /api/auth/verify-otp`. Mã có hiệu lực 5 phút;
chờ 60 giây giữa các lần gửi được tiếp nhận.

## CI/CD

[CI](.github/workflows/ci.yml) chạy khi mở hoặc cập nhật Pull Request và khi push lên `main`.
CI kiểm tra frontend, backend và chạy thử luồng đặt hàng qua Docker Compose trên dữ liệu mẫu.

Khi CI chạy thành công trên bản mới nhất của `main`, [CD](.github/workflows/cd.yml) phát hành hai image lên GitHub Container Registry với tag `latest` và `sha-<commit>`.

- `ghcr.io/letan01012006/brewlite/backend`
- `ghcr.io/letan01012006/brewlite/frontend`

Xem kết quả trong [GitHub Actions](https://github.com/letan01012006/brewlite/actions). Hai image có thể được dùng để triển khai lên host.

## Tài liệu

- [Backend: sản phẩm, topping và nâng cấp dữ liệu](backend/README.md#product-và-topping)
- [Kiểm thử frontend và xử lý trình duyệt từng chạy PWA](frontend/test/README.md)

## Quy ước làm việc

Nhánh: `main` ← `develop` ← `feature/task-x-ten`. Thay đổi qua Pull Request,
cần một người review. Commit dùng `feat:`, `fix:`, `docs:` hoặc `chore:`.
