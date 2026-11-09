# Đăng ký, OTP, đăng nhập và cấp tài khoản nhân viên

Triển khai theo UC01/UC02 và UC75 của [Longcodepro](https://github.com/Longcodepro/Project_SE_HK1_2026_2027), đối chiếu commit `97ebf91eb70eccd86f9c80eaba1a377ac49dca4d`: `register.use-case.ts`, `verify-register-otp.use-case.ts`, `resend-otp.use-case.ts`, `login.use-case.ts`, `otp.service.ts`, `CreateStaffUseCase` trong `admin-users.use-cases.ts`. Áp dụng vào module NestJS hiện có của BrewLite; `STAFF` ánh xạ sang `BARISTA`.

## Khởi động demo local

Chuỗi lệnh `npm.cmd ci` → `npx.cmd prisma migrate deploy` → `npx.cmd prisma generate` → `npm.cmd run start:dev` cũng dùng được với `.env` cũ. Hook `prestart:dev` tự tạo và lưu OTP_HASH_SECRET còn thiếu, không ghi đè cấu hình khác; mặc định OTP ngẫu nhiên được in trong log. Để dùng đúng demo 123456 và cấu hình quản lý bên dưới, tiếp tục dùng `.env.auth-demo` hoặc đặt AUTH_OTP_DEMO=true trong `.env` dev.

Đã chạy lại đúng chuỗi lệnh này: `npm.cmd ci` cài 440 packages thành công, `migrate deploy` báo không còn migration chờ, `generate` tạo client 6.19.3 thành công, `start:dev` báo `Found 0 errors` và `Nest application successfully started`. `/api/health`, `/api/docs`, `/api/docs-json` và đăng nhập email cũ đều trả HTTP 200. Đã xác nhận hook chạy lại không thay đổi `.env`, và khi NODE_ENV=production thì từ chối trước khi ghi file. npm ci còn báo 18 vấn đề bảo mật dependency và cảnh báo install scripts; các lệnh cài đặt/Prisma/khởi động đều exit thành công hoặc chạy ổn định. Không dùng `npm audit fix --force` để tránh tự nâng Prisma sang major mới.

Đã sửa lỗi Windows `EPERM ... unlink dist/generated/prisma/query_engine-windows.dll.node`: Prisma dùng `engineType = "client"` với adapter PostgreSQL sẵn có, Nest không sao chép DLL query engine vào `dist` và binary cũ trong generated source được loại bỏ. Không đổi database schema hoặc tạo migration mới cho thay đổi engine này. Nếu còn tiến trình của bản cũ đang giữ DLL, cần dừng bản cũ một lần trước khi generate/build bản mới. Dừng backend bằng Ctrl+C trước khi chạy `npm.cmd ci` để cài lại dependencies.

Cấu hình không dùng native query engine được hỗ trợ trong [Prisma ORM v6](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/no-rust-engine). Giữ nguyên phiên bản Prisma/adapter hiện có; đã chạy lại 51 unit test và 93 integration test PostgreSQL đều đạt. Auth xử lý được cả metadata lỗi unique của library engine và driver adapter để giữ đúng PHONE_ALREADY_EXISTS/EMAIL_ALREADY_EXISTS.

Kiểm tra thực tế sau sửa DLL: hai lần `npm.cmd run start:dev`, một lần sửa source để hot reload, và chuỗi dừng → `prisma generate` → khởi động lại đều đạt. Source/generated và dist không còn DLL query engine; health, Swagger và đăng nhập email cũ đều HTTP 200. Report: `../../.brewlite-verification/backend-no-dll-startup.json`; log test: `backend-no-dll-unit.log`, `backend-no-dll-e2e.log` trong cùng thư mục. Toàn bộ cây tiến trình do bài kiểm tra tạo đã được dừng để bạn tự khởi động.

Database local hiện tại đã được áp dụng migration mới và tạo MANAGER demo. API chạy ở http://localhost:4000/api/docs, web ở http://localhost:3000. Nếu cần khởi động lại, chạy từ thư mục `brewlite`:

```powershell
cd backend
# Chỉ copy nếu chưa có file, không ghi đè cấu hình đang dùng.
if (!(Test-Path .env.auth-demo)) { Copy-Item .env.auth-demo.example .env.auth-demo }
npx.cmd prisma generate
npx.cmd prisma migrate deploy
node --env-file=.env.auth-demo --import tsx prisma/seed-manager.ts
npm.cmd run build
node --env-file=.env.auth-demo dist/main.js
```

Terminal khác:

```powershell
cd frontend
npm.cmd run build
npm.cmd run start
```

`.env` vẫn cung cấp DATABASE_URL/JWT_SECRET. `.env.auth-demo` chứa cấu hình riêng: NODE_ENV=development, AUTH_OTP_DEMO=true, OTP_HASH_SECRET, AUTH_DEMO_SEED=true, DEMO_MANAGER_PHONE và DEMO_MANAGER_PASSWORD. Không commit `.env.auth-demo`. `seed-manager.ts` chỉ tạo quản lý; không chạy lại seed danh mục/kho. Seed tổng `prisma db seed` cũng gọi `seedManager` khi được bật, dùng cùng các biến môi trường này. Seed không thay đổi tài khoản có sẵn và từ chối nếu số demo đang thuộc người dùng khác.

Để chạy dev/watch với cấu hình demo, dùng `node --env-file=.env.auth-demo node_modules/@nestjs/cli/bin/nest.js start --watch`. Muốn dùng OTP ngẫu nhiên local, đặt AUTH_OTP_DEMO=false; đọc mã tại log backend `[SMS local] <phone>: OTP <code>`.

## Ba luồng trên web và Swagger

### 1. Khách mới tự đăng ký → OTP → đăng nhập

1. Mở http://localhost:3000/register. Nhập tên, số điện thoại mới gồm 10 chữ số bắt đầu bằng 0, mật khẩu 8–64 ký tự có chữ và số, xác nhận mật khẩu. Có thể bỏ email trống. Ví dụ `0912345678` / `Customer@123` nếu số chưa được dùng.
2. Bấm đăng ký: POST `/api/auth/register` trả **201** với `requiresOtp=true`, `expiresIn=300`, `resendAfter=60`; chưa có JWT, chưa cộng điểm. Web mở `/verify-otp?phone=...`.
3. Nhập **123456** trong demo. POST `/api/auth/verify-otp` trả **200** `{ accessToken, tokenType: "Bearer", expiresIn, user }`. Web gọi `setAuth(user, accessToken)`, nạp giỏ theo user.id và đăng nhập ngay. Tài khoản nhận **1000 WELCOME_POINTS đúng một lần**.
4. Đăng xuất, mở `/login`, giữ lựa chọn **Số điện thoại**, nhập số và mật khẩu vừa tạo: đăng nhập thành công.
5. Nếu bỏ qua OTP rồi đăng nhập bằng đúng mật khẩu, API trả **403 PHONE_NOT_VERIFIED** và web đưa về màn OTP. Sai mật khẩu vẫn là **401 INVALID_CREDENTIALS**.

Swagger có cùng các API: `/api/auth/register`, `/api/auth/verify-otp`, `/api/auth/resend-otp`, `/api/auth/login`, `/api/auth/me`. Gửi JSON phone/code dưới dạng chuỗi để giữ số 0 đầu. Đăng ký không nhận role.

### 2. Quản lý cấp barista → đăng nhập ngay → /barista

1. Đăng nhập trên web bằng **0900000001 / Manager@123**. Web mở `/manager` với liên kết Swagger.
2. Mở http://localhost:4000/api/docs. Tại POST `/api/auth/login`, chọn example **Khách mới / quản lý / nhân viên**, bấm Try it out → Execute:

```json
{ "phone": "0900000001", "password": "Manager@123" }
```

3. Sao chép `accessToken`, bấm **Authorize**, dán token thuần (Swagger tự thêm Bearer).
4. Tại POST `/api/admin/staff`, Try it out → Execute với số mới:

```json
{ "fullName": "Nhân viên BrewLite", "phone": "0912345679", "password": "Barista@123" }
```

5. API trả **201**, `role=BARISTA`, `isPhoneVerified=true`, `email=null`. Có thể bổ sung email tùy chọn. Backend không trả hash/mật khẩu/OTP.
6. Đăng xuất quản lý trên web, đăng nhập bằng **0912345679 / Barista@123**. Không cần OTP; web chuyển thẳng **/barista** và nạp được đơn quầy.
7. Đổi Authorize sang token của khách hoặc barista rồi gọi cùng API cấp nhân viên: **403 FORBIDDEN**. Không có JWT: **401**. MANAGER là quyền riêng; không tự động mở rộng quyền quản lý kho/quầy vốn dành cho BARISTA.

### 3. Tài khoản cũ tiếp tục dùng email

1. Mở `/login`, chọn **Email (tài khoản cũ)**.
2. Khách demo cũ: **demo@brewlite.com / Demo@1234** → trang khách.
3. Barista demo cũ: **barista@brewlite.com / Barista@123** → **/barista**.
4. Swagger POST `/api/auth/login`: chọn example **Tài khoản cũ chưa có phone**, gửi chỉ `email` và `password`. Email chỉ áp dụng cho tài khoản có `phone=null`; không gửi đồng thời email và phone.

Hai tài khoản email demo có sẵn đã được kiểm tra trên database local hiện tại. ID, hash mật khẩu, điểm, vai trò và lịch sử đơn giữ nguyên; các tài khoản cũ khác dùng thông tin đăng nhập vốn có.

## Hành vi lỗi và bảo mật OTP

| Trường hợp | Kết quả |
| --- | --- |
| Sai số điện thoại, mật khẩu yếu, role do client gửi | 400 |
| Trùng phone/email, kể cả hai đăng ký đồng thời | 409 PHONE_ALREADY_EXISTS / EMAIL_ALREADY_EXISTS |
| OTP sai | 400 OTP_INVALID; số lần sai được commit |
| Sai lần thứ 5 và mọi lần sau | 400 OTP_ATTEMPTS_EXCEEDED, kể cả gửi mã đúng |
| OTP hết 5 phút | 400 OTP_EXPIRED |
| OTP đã dùng, tài khoản đã xác thực hoặc không có mã | 400 OTP_INVALID_OR_USED |
| Gửi lại trước 60 giây | 429 OTP_RESEND_TOO_SOON |
| Gửi lại hợp lệ | 200, thay hash cũ, đặt lại hạn 5 phút và attempts=0 |
| Hai xác thực đúng đồng thời | Chính xác một 200, một 400; chỉ cộng điểm một lần |
| Sai thông tin đăng nhập | 401 INVALID_CREDENTIALS |
| Đúng mật khẩu, chưa xác thực phone | 403 PHONE_NOT_VERIFIED |

OTP được lưu dưới dạng HMAC-SHA256 với OTP_HASH_SECRET riêng, tối thiểu 32 ký tự; không trả mã qua HTTP. Xác thực/gửi lại đều khóa dòng User bằng `SELECT ... FOR UPDATE` trong transaction Prisma. Lỗi sai mã được ném sau khi transaction đã commit để giữ bộ đếm. Thành công xóa hash/hạn OTP, xác thực và cộng điểm cùng transaction; `welcomePointsGrantedAt` ngăn cấp lại.

AUTH_OTP_DEMO=true chỉ được phép khi NODE_ENV=development/test; production hoặc NODE_ENV không thuộc hai môi trường này sẽ từ chối bật demo. Chế độ ngẫu nhiên chủ động loại mã 123456. Bản này có SMS giả lập local; production chưa có SMS provider thật, nên đăng ký/gửi lại trả 503 SMS_NOT_CONFIGURED, còn đăng nhập tài khoản có sẵn vẫn hoạt động khi cấu hình bí mật đầy đủ. Trước khi triển khai production phải tích hợp SMS provider và thay các bí mật demo.

## Migration và kiểm chứng dữ liệu

Migration: `backend/prisma/migrations/20261109090000_phone_auth_manager/migration.sql`.

Chỉ thêm role MANAGER, phone unique nullable, isPhoneVerified, hash/hạn/thời điểm gửi/số lần sai OTP, welcomePointsGrantedAt; cho phép email null. Không đổi ID, passwordHash, role, loyaltyPoints hoặc quan hệ cũ. User cũ giữ `phone=null`, không bị chặn bởi bước xác thực số điện thoại.

Đã dump database `brewlite` sang database mới **brewlite_auth_upgrade_1794241474579**, chạy `prisma migrate deploy` trên bản sao rồi so sánh SHA-256 của mọi hàng/cột cũ trong **17 bảng**. Có **4 user cũ, 3 đơn, 4 dòng món, 3 thanh toán, 2 giao dịch điểm** cùng dữ liệu kho/danh mục. Toàn bộ hash bằng nhau trước/sau migration, nguồn không thay đổi trong bài kiểm tra. Sau đó đã migrate database local và chỉ seed thêm MANAGER. Không reset database, không xóa volume.

Chạy lại kiểm tra trên bản sao mới (Docker Desktop đang chạy, DATABASE_URL trỏ database nguồn local):

```powershell
cd backend
npm.cmd run test:database:auth
```

Script `prisma/auth-upgrade-check.cjs` tạo database mới với tên riêng mỗi lần, dùng `pg_dump/pg_restore`, không ghi vào database nguồn và giữ database test để kiểm tra. Có thể cấu hình AUTH_TEST_DB_CONTAINER nếu tên container khác `brewlite-db-1`. Không dùng `migrate reset`, `db push --force-reset` hoặc xóa volume.

## Kết quả kiểm thử thực tế

Chạy ngày 09/11/2026, PostgreSQL 16 local, Node 24.18, NestJS/Prisma/Next.js đang có trong repository.

| Thư mục | Lệnh | Kết quả |
| --- | --- | --- |
| backend | `npx.cmd prisma generate` | Thành công |
| backend | `npm.cmd run test:database:auth` | PASS: migrate deploy bản sao, hash 17 bảng cũ không đổi |
| backend | `npx.cmd prisma migrate deploy` | Áp dụng migration mới vào local thành công |
| backend | `npm.cmd run build` | PASS |
| backend | `npm.cmd test` | 51/51 PASS |
| backend | `npm.cmd run test:e2e` | 93/93 PASS, gồm 16 test auth/OTP/migration/manager |
| backend | `npm.cmd run lint` | Exit 0; cảnh báo cũ trong payment/VNPAY |
| frontend | `npx.cmd tsc --noEmit` | PASS |
| frontend | `npm.cmd test` | 113/113 PASS |
| frontend | `npm.cmd run lint` | PASS |
| frontend | `npm.cmd run build` | PASS sau khi chạy lại; Next.js có cảnh báo bảo mật phiên bản hiện tại |
| frontend | `npm.cmd run test:browser:auth` | PASS: Chrome thật, 8 kiểm tra, không runtime exception/API 5xx |

Test backend dùng TEST_DATABASE_URL ở database khác với DATABASE_URL và schema riêng từng lần. Bao gồm dữ liệu tài khoản/đơn được tạo trước migration auth, đăng nhập email cũ, OTP sai/hết hạn/đã dùng/đồng thời, 5 lần sai đồng thời, cooldown và gửi lại đồng thời, mã cũ bị thay thế, điểm chỉ cấp một lần, trùng dữ liệu đồng thời, role injection, quyền hiện tại trong DB thắng claim JWT cũ, seed quản lý và Swagger.

Test Chrome nhập form thật trên web: đăng ký không email, sai OTP rồi đúng OTP, reload với email=null, đăng nhập phone, khách chưa xác thực chuyển về OTP, MANAGER cấp BARISTA qua API, barista vào /barista và nhận 403 khi cấp nhân viên, hai tài khoản email cũ, Swagger UI. Test tạo thêm các tài khoản có tên “Khách trình duyệt”, “Khách chờ OTP”, “Barista trình duyệt” trên local để kiểm tra, không sửa tài khoản cũ. Cấu hình AUTH_BROWSER_OUTPUT có thể trỏ thư mục lưu report JSON và ảnh OTP mobile/quầy/Swagger.

Log gốc và report nằm ngoài repo tại `../../.brewlite-verification/` tính từ backend/frontend: `auth-backend-unit.log`, `auth-backend-e2e.log`, `auth-frontend-test.log`, `auth-frontend-build.log`, `auth-upgrade-report.json`, `auth-browser/result.json`. `auth-live-preservation.json` xác nhận thêm rằng sau migrate local, seed quản lý và toàn bộ browser test, 4 tài khoản gốc cùng dữ liệu cũ của 17 bảng vẫn giữ nguyên hash. Test lỗi có chủ đích của kho/thanh toán ghi log ERROR nhưng assertions đều qua.

Build phát hiện Next.js 16.4.0 đang có cảnh báo lỗ hổng bảo mật và khuyến nghị nâng cấp; phiên bản phụ thuộc được giữ nguyên trong thay đổi nghiệp vụ này.

## File thay đổi

- Database: `backend/prisma/schema.prisma`, migration mới, `manager-seed.ts`, `seed-manager.ts`, `seed.ts`, `auth-upgrade-check.cjs`; Prisma client trong `backend/src/generated/prisma/` được generate lại.
- Backend: `src/auth/auth.controller.ts`, `auth.service.ts`, `auth.module.ts`, `jwt.strategy.ts`, `otp.service.ts`, `staff.controller.ts`, DTO register/login/otp và barrel index, JWT interfaces; `src/common/decorators/roles.decorator.ts`.
- Cấu hình: `backend/.env.example`, `.env.auth-demo.example`, `.gitignore`, `package.json`, `vitest.config.e2e.ts`; `frontend/package.json` thêm browser test.
- Frontend: `src/app/(auth)/register/page.tsx`, `login/page.tsx`, `verify-otp/page.tsx`, `src/app/manager/page.tsx`, `src/app/barista/page.tsx`, `src/types/index.ts`, `src/components/auth/customer-gate.tsx`. Auth store vẫn dùng `setAuth(user, accessToken)` và giỏ vẫn nạp theo ID.
- Test: `backend/test/auth-phone.e2e-spec.ts`, `database-fixture.ts`, `security-concurrency.e2e-spec.ts`, `payments-vnpay.e2e-spec.ts`, `frontend/test/auth-browser-smoke.mjs`.
- Bàn giao: `README.md`, `docs/auth-demo.md`.
