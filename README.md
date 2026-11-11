# BrewLite

Luồng đăng ký số điện thoại, OTP và cấp tài khoản nhân viên: xem [hướng dẫn demo và kết quả kiểm thử](docs/auth-demo.md).

Ứng dụng đặt cà phê không dùng tiền mặt. NestJS + Next.js + PostgreSQL (Prisma).

## Yêu cầu

Git và Docker Desktop để chạy toàn bộ ứng dụng bằng Compose.
Node.js 24.15+ (hoặc 26) chỉ cần khi phát triển trên máy hoặc chạy script kiểm tra.

Các lệnh dưới đây dùng PowerShell trên Windows. Trên macOS/Linux, dùng `npm`,
`npx` thay cho `npm.cmd`, `npx.cmd` và `cp` thay cho `Copy-Item`.
Mở Docker Desktop và chờ Docker Engine sẵn sàng trước khi chạy database.

## Chạy frontend, backend và PostgreSQL bằng Docker

Mở Docker Desktop. Tại thư mục gốc, nếu chưa có `backend/.env`, tạo từ mẫu:

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Giữ nguyên file `.env` đang dùng và database trong `DATABASE_URL`. Với cấu hình mới,
đặt `JWT_SECRET` và `OTP_HASH_SECRET` riêng; khóa OTP phải dài ít nhất 32 ký tự.
Sau đó chạy một lệnh:

```powershell
docker compose up --build
```

| Thành phần | Địa chỉ |
| --- | --- |
| Frontend/menu | http://localhost:3000/menu |
| Swagger | http://localhost:4000/api/docs |
| Backend health | http://localhost:4000/api/health |
| API qua frontend | http://localhost:3000/api/health |
| PostgreSQL trên máy | localhost:5432 |

Compose gắn lại volume **`brewlite_pgdata`** đang có, kể cả khi thư mục checkout đổi tên.
Backend chờ `db` healthy, chạy `prisma migrate deploy`, rồi mới mở HTTP. Frontend
chờ backend healthy. Migration lỗi sẽ dừng backend; Compose không reset hoặc seed
database tự động. Các file `.env`, `node_modules` và output trên Windows được loại
khỏi build context; dependencies và Prisma client được dựng lại trong Linux.

Backend đọc `backend/.env`; entrypoint chỉ thay host/port của `DATABASE_URL`
thành **`db:5432`**, giữ nguyên tên database, tài khoản, mật khẩu và query parameters.
Vì vậy database đang dùng không bị chuyển nhầm sang database mặc định `brewlite`.
`POSTGRES_DB=brewlite` ở service `db` chỉ là database tạo khi volume hoàn toàn mới.
Nếu dùng volume mới, bắt đầu với URL `.../brewlite` trong `.env.example`.

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | URL hiện có trong `backend/.env`; tên database phải tồn tại trong volume hiện tại. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Khóa và thời hạn token; giữ khóa hiện có để phiên đăng nhập còn hợp lệ. |
| `OTP_HASH_SECRET` | Khóa OTP riêng, ít nhất 32 ký tự; giữ ổn định sau restart. |
| `NODE_ENV` | `development` cho demo local có SMS giả lập; `production` cần SMS provider. |
| `AUTH_OTP_DEMO` | `true` dùng OTP local `123456`, chỉ trong development/test. |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | Thông tin merchant thật/sandbox; thiếu hoặc giá trị mẫu thì VNPAY trả 503. |
| `VNPAY_RETURN_URL` | Local: `http://localhost:3000/payment/vnpay-return`. |
| `PAYMENT_EXPIRE_MINUTES`, `ORDER_PENDING_EXPIRE_MINUTES` | Thời hạn phiên thanh toán/đơn chưa thanh toán. |
| `PAYMENT_MOCK_ENABLED` | Cho phép WALLET/CARD giả lập khi cần demo. |
| `BACKEND_API_URL` | Compose đặt `http://backend:4000/api` lúc build frontend; trình duyệt gọi `/api` cùng origin. |

Frontend là bản standalone, backend chạy JavaScript đã build. Sửa code rồi chạy lại
`docker compose up --build`. Thay đích rewrite frontend cũng cần build lại.
Nếu chưa có dữ liệu và muốn seed demo, chạy thủ công:

```powershell
docker compose run --rm backend npx prisma db seed
```

Chạy nền, xem trạng thái và khởi động lại:

```powershell
docker compose up --build -d --wait
docker compose ps
docker compose logs backend
docker compose restart
docker compose up -d --wait
docker compose stop
```

`stop` và `restart` giữ nguyên volume. Không dùng `docker compose down -v` để dừng
hằng ngày vì lệnh đó xóa dữ liệu PostgreSQL.

Kiểm tra dữ liệu trước/sau chạy và sau restart (cần Node.js):

```powershell
node scripts/compose-smoke.mjs baseline
docker compose up --build -d --wait
node scripts/compose-smoke.mjs verify
docker compose restart
docker compose up -d --wait
node scripts/compose-smoke.mjs verify
```

Script chỉ đọc dữ liệu: đối chiếu số lượng/mã băm sản phẩm, nguyên liệu, đơn hàng;
kiểm tra volume, health cả ba service, Swagger và API qua frontend. Nó dùng tài khoản
BARISTA đã có để đọc API riêng, không tạo người dùng hoặc đơn thử. Snapshot nằm trong
`.local-backups/`; chạy khi không có giao dịch đang thay đổi dữ liệu. Đơn cũ quá hạn
có thể được job chuyển từ `PENDING`/`PAYMENT_FAILED` sang `CANCELLED`; script báo riêng
việc này và vẫn kiểm tra mọi trường lịch sử còn lại.

Đã kiểm tra ngày 11/11/2026 với database đang dùng `brewlite_payment_verified_20261105`
trên volume `brewlite_pgdata`: cả ba service healthy, Swagger/API hoạt động, giữ đủ
**10 sản phẩm, 14 nguyên liệu, 52 đơn hàng** sau build và restart. Sản phẩm/nguyên liệu
khớp mã băm ban đầu, các trường lịch sử của đơn khớp backup; 4 đơn cũ quá hạn được
job hủy theo luồng hiện có. Chrome headless đã render menu qua API cùng origin.
Có thể chạy lại kiểm tra trình duyệt (cài Chrome; đặt `CHROME_PATH` nếu khác đường dẫn
Windows mặc định):

```powershell
node scripts/compose-menu-browser.mjs
```

## Chạy với Node trên máy (tùy chọn)

Dừng container frontend/backend trước khi chạy server Node trên cùng cổng.

### 1. Tải mã nguồn và khởi động database

```powershell
git clone https://github.com/letan01012006/brewlite.git
cd brewlite
docker compose up -d db
```

Trong cách chạy Node này, chỉ bật service PostgreSQL ở cổng **5432**.
Backend và frontend chạy riêng ở hai terminal bên dưới.
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

Với `.env` từ phiên bản cũ, `npm.cmd run start:dev` tự bổ sung `OTP_HASH_SECRET`
ngẫu nhiên nếu thiếu và giữ nguyên các cấu hình đã có. Khóa được lưu để OTP vẫn
hợp lệ sau khi khởi động lại. Cơ chế này chỉ chạy trong dev/test; production phải
cấu hình khóa riêng. OTP local mặc định là mã ngẫu nhiên ghi ở log backend;
đặt `AUTH_OTP_DEMO=true` trong `.env` nếu muốn dùng mã demo `123456`.

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate status
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

## Những lần chạy Node tiếp theo

Mở Docker Desktop. Từ thư mục gốc `brewlite`, khởi động database:

```powershell
docker compose up -d db
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
npx.cmd prisma migrate status
npx.cmd prisma migrate deploy
```

Nếu `.env.example` có biến mới, bổ sung vào file môi trường đang dùng;
không copy đè làm mất cấu hình riêng. Chỉ seed lại khi cần bổ sung dữ liệu demo.
Khởi động lại server sau khi cập nhật.

### Product và topping

Topping thuộc `ProductsModule`, vẫn là model riêng và liên kết nhiều–nhiều với
Product. Chi tiết nâng cấp dữ liệu cũ, seed an toàn và API xem
[backend/README.md](backend/README.md#product-và-topping).
Trước khi áp dụng migration, kiểm tra `migrate status`: chỉ tiếp tục khi không
có migration lỗi/lệch lịch sử. Với database mới, các migration chưa áp dụng là
bình thường. Không dùng reset hoặc xóa volume để xử lý lỗi migration.

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
