# Test BrewLite API bằng Postman

## Chạy toàn bộ 65 request tự động

Từ thư mục gốc của dự án, khi Docker/PostgreSQL đã chạy và backend đã build:

```powershell
node backend/postman/run-full.mjs
```

Lệnh dùng **Postman CLI chính thức** có trên `PATH`. Nếu chưa có bản build,
chạy `npm.cmd run build` trong `backend` trước. Nếu cần cài CLI, xem
[tài liệu Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-overview/).
Có thể đặt biến môi trường `POSTMAN_CLI` thành đường dẫn tới CLI.

Mỗi lần chạy tạo database `brewlite_postman_*` riêng trên PostgreSQL local,
áp dụng migrations và seed, rồi mở API kiểm thử ở cổng **4010** và bộ mô phỏng
ngân hàng VNPAY ở cổng **4011**. OTP dùng `SMS_PROVIDER=local` và mã demo `123456`.
Phần ngân hàng mô phỏng kiểm tra chữ ký URL/thanh toán, gửi IPN sai chữ ký,
IPN thành công, IPN trùng và xác minh chữ ký yêu cầu hoàn tiền. BrewLite vẫn
chạy các controller, guard, service và transaction PostgreSQL thực.

Đây là kiểm thử tích hợp local; kết quả không xác nhận SMS eSMS được gửi thực
hoặc tiền được thanh toán/hoàn qua ngân hàng VNPAY thật. Thông tin dịch vụ thật
trong `backend/.env` không được dùng bởi hai bộ mô phỏng này.

Luồng OTP đã xếp đúng `Register → chờ 61 giây → Resend → Verify → Login` để
kiểm tra cả giới hạn gửi lại thực của backend. Toàn bộ collection mất hơn
một phút. Các HTTP 400/401/403/422 trong folder Error cases là kết quả mong đợi.

Kết quả gần nhất: [reports/latest-run.md](reports/latest-run.md) và
[reports/latest-run.json](reports/latest-run.json). Log CLI, collection và
environment của từng lần chạy nằm trong `.local-backups/postman-runs/`.
API và bộ mô phỏng được dừng khi chạy xong; database kiểm thử được giữ lại.

Muốn dùng **Collection Runner trong app Postman**, mở một terminal riêng:

```powershell
node backend/postman/run-full.mjs --serve
```

Giữ terminal chạy, import hai file `BrewLite-Full.postman_*.json` từ thư mục
được in ra, chọn environment **BrewLite Full local run**, rồi **Run** toàn bộ
collection **BrewLite API - Full local run**, 1 iteration. Dùng cổng khác bằng
`POSTMAN_API_PORT` / `POSTMAN_GATEWAY_PORT` nếu 4010/4011 đang bận.

Hai file template bên dưới phục vụ thao tác thủ công với backend cổng 4000.

## 1. Import và chọn environment

Trong Postman, chọn **Import**, chọn cả hai file cùng thư mục này:

- `BrewLite.postman_collection.json` — 65 request, chia thành 9 folder.
- `BrewLite-Local.postman_environment.json` — environment **BrewLite Local**.

Chọn **BrewLite Local** ở danh sách environment góc phải. `base_url` mặc định là
`http://127.0.0.1:4000/api`, không có dấu `/` cuối. Không cần chạy frontend.

Nếu import environment chưa xong hoặc bạn muốn dùng ngay, giữ **No Environment**:
collection đã có cấu hình mặc định và tự lưu token/ID vào **Variables** của
collection. Khi chọn environment có `base_url`, scripts chuyển sang lưu tại đó.
Với các hướng dẫn chỉnh biến bên dưới, sửa trong Variables của collection nếu
bạn đang dùng No Environment.

Mỗi request đã có method, URL, JSON body, Bearer token đúng vai trò và assertions
trong **Scripts → Post-response**. Request đăng nhập tự lưu token; các request
khác tự dùng token tương ứng. Không cần tự copy token vào Authorization.

## 2. Chạy database và backend

Mở Docker Desktop và chờ Engine sẵn sàng. Từ thư mục gốc `brewlite`:

```powershell
docker compose up -d db
docker compose exec db pg_isready -U brewlite -d brewlite
```

Khi PostgreSQL báo `accepting connections`, chạy backend:

```powershell
cd backend
# Nếu chưa cài dependencies:
npm.cmd ci
# Chỉ copy .env khi file chưa tồn tại; giữ cấu hình hiện có.
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Trong `backend/.env`, đặt `JWT_SECRET` thành chuỗi bí mật riêng và giữ
`DATABASE_URL` trỏ đến PostgreSQL local. `OTP_HASH_SECRET` cần ít nhất 32 ký tự;
`npm.cmd run start:dev` tự bổ sung khóa nếu chưa có. Để dùng thanh toán giả lập,
đặt `PAYMENT_MOCK_ENABLED=true` trong môi trường development.

Hoặc chỉ bật mock cho terminal hiện tại, giữ nguyên `.env`:

```powershell
$env:PAYMENT_MOCK_ENABLED='true'
npm.cmd run start:dev
```

Khi setup lần đầu hoặc có migrations mới:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate status
# Chỉ tiếp tục nếu lịch sử migration không lỗi/lệch; pending là bình thường.
npx.cmd prisma migrate deploy
npx.cmd prisma db seed
npm.cmd run start:dev
```

Nếu dự án đã setup database, chỉ cần `npm.cmd run start:dev`. Giữ terminal này mở.
Kiểm tra `GET http://127.0.0.1:4000/api/health` trả
`{"status":"ok","db":"up"}`. Swagger: <http://127.0.0.1:4000/api/docs>.

Seed bổ sung tài khoản, sản phẩm, topping, công thức, nguyên liệu và mã giảm giá.
Seed không ghi đè tài khoản hoặc bổ sung lại số tồn đã dùng của nguyên liệu cũ.

| Vai trò | Email | Mật khẩu local demo |
| --- | --- | --- |
| Customer | `demo@brewlite.com` | `Demo@1234` |
| Barista | `barista@brewlite.com` | `Barista@123` |

## 3. Test nhanh

1. Mở folder **00 Quick start - run first** → **Run folder**, chọn tất cả request
   và chạy 1 iteration. Hoặc mở từng request rồi bấm **Send** theo số thứ tự.
   Folder này kiểm tra DB, đăng nhập Customer/Barista, lấy món và size thực còn
   đủ nguyên liệu cho 2 ly, xem menu và lịch sử đơn.
2. Chạy folder **01 Checkout demo - run after 00** theo thứ tự. Luồng:
   `PENDING → PAID → PREPARING → READY → COMPLETED`. Thanh toán dùng WALLET mock.
   Hai request Replay kiểm tra không tạo trùng đơn và giao dịch. Khi PREPARING,
   nguyên liệu được trừ thật trong database local.
3. Mở **Test Results** ở response hoặc kết quả Runner. Các assertions cần PASS.
4. Muốn chạy checkout lần nữa, chạy lại folder 00 rồi 01. Login Customer trong
   folder 00 xóa ID/key checkout cũ để bắt đầu phiên mới; token Barista được lưu
   riêng nên không bị thay bằng token Customer.

Các biến `product_id`, `size`, `order_id`, `payment_id`, token và idempotency key
được lưu vào environment sau request tương ứng. ID không hardcode theo seed.
Khi đổi sang backend khác, import lại environment hoặc xóa các token/ID/key cũ.

**Khi request tạo đơn/thanh toán bị timeout:** giữ nguyên body và
`Idempotency-Key`, gửi lại cùng request hoặc request Replay tương ứng. Đừng chạy
lại Login Customer giữa chừng vì thao tác đó xóa key. Nếu thay giỏ hàng, bắt đầu
phiên mới thay vì dùng key cũ với nội dung khác.

## 4. Các folder khác

| Folder | Cách dùng |
| --- | --- |
| 02 Cancel unpaid order | Sau 00, tạo một đơn PENDING riêng rồi hủy; không dùng đơn đã COMPLETED. |
| 03 Promotions | Sau 00; BREW10 cần tổng đơn từ 50.000đ. Request HETHAN mong đợi HTTP 422. |
| 04 Inventory | Sau 00; xem nguyên liệu, kho, biến động và công thức bằng Barista. Request topping recipe chỉ gửi khi có `topping_id`. |
| 05 Catalog + inventory demo | Sau 00; chạy theo thứ tự để tạo nguyên liệu, topping và món demo riêng, nhập kho, cấu hình công thức, ghi hao hụt và thử tạm dừng/mở bán. Các ID dùng tiền tố `demo_`. |
| 06 Auth phone + Manager | Gửi thủ công từng request phù hợp sau khi cấu hình bên dưới. |
| 07 Error cases | Sau 00; các lỗi 400/401/403 là mong đợi, assertions vẫn phải PASS. |
| 08 VNPAY + refund | Gửi thủ công sau khi có cấu hình sandbox thật; có thao tác hoàn tiền. |

**Không Run toàn bộ collection.** Các folder tùy chọn có điều kiện riêng; thao
tác ghi sẽ lưu vào database. Với demo nhập kho/hao hụt, mỗi lần bấm Send tạo key
mới; để thử gửi trùng hoặc retry sau timeout, lấy key đã lưu trong environment
và giữ nguyên key/body (tắt script tạo key mới ở request đó trước khi retry).

### Đăng ký bằng số điện thoại và OTP

Trong environment, điền `register_phone` bằng số điện thoại test chưa tồn tại,
và `register_password`. Đăng ký không trả JWT cho đến khi xác thực OTP.

Nếu muốn demo offline, cấu hình rõ ràng trong `backend/.env` rồi restart backend:

```dotenv
NODE_ENV=development
SMS_PROVIDER=local
AUTH_OTP_DEMO=true
```

Khi đó điền `otp_code=123456` trong Postman. Nếu dùng eSMS thật, điền mã nhận
được trên số điện thoại của bạn; mã không phải cố định `123456`. Bộ setup này
không thay cấu hình eSMS hiện có.

Chạy `Register → Verify OTP → Login phone → Profile`. `Resend OTP` dùng trước
verify khi cần mã mới; phải chờ ít nhất 60 giây sau lần gửi thành công gần nhất.
Token tài khoản phone lưu riêng ở `phone_token`.

### Manager cấp Barista

Seed mặc định không tạo Manager. Nếu cần demo local, thêm vào `backend/.env`:

```dotenv
NODE_ENV=development
AUTH_DEMO_SEED=true
DEMO_MANAGER_PHONE=0900000001
DEMO_MANAGER_PASSWORD=Manager@123
```

Chạy `npx.cmd prisma db seed` trong `backend`, sau đó đặt
`manager_phone=0900000001`, `manager_password=Manager@123` trong environment.
Đặt `staff_phone` bằng số test chưa tồn tại và chạy
`Login Manager → Manager creates Barista → Login newly created staff`.
Tài khoản Barista được cấp đã xác thực, không cần OTP.

### VNPAY sandbox

Cấu hình `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, URL sandbox và return URL trong
`backend/.env`, rồi restart backend. Không đưa hash secret vào environment Postman.
Folder 08 tạo một đơn riêng, lưu `vnpay_order_id`, `vnpay_payment_id` và
`vnpay_payment_url`. Mở URL trong trình duyệt để thanh toán sandbox. Giao dịch
được xác nhận qua callback có chữ ký; đọc trạng thái bằng request payment detail.
IPN/return không có query ký hợp lệ sẽ không xác nhận thanh toán.
Refund chỉ dùng khi giao dịch đã thành công và đủ điều kiện hoàn tiền.

## 5. Lỗi thường gặp

- `ECONNREFUSED`: kiểm tra backend ở cổng 4000 và `base_url`, mở Docker Desktop,
  chạy `docker compose up -d db` rồi `npm.cmd run start:dev` trong backend.
- HTTP 500 ở Health: kiểm tra PostgreSQL, `DATABASE_URL` và migrations.
- Nếu `localhost` trỏ đến một backend/container khác qua IPv6, giữ
  `base_url=http://127.0.0.1:4000/api` để gửi đến backend local qua IPv4.
- HTTP 401: chọn đúng environment và chạy Login đúng vai trò. Nếu tài khoản cũ
  đã có phone, đổi body login từ `email` sang `phone`; không gửi cả hai.
- HTTP 403: request cần Barista/Manager phải dùng đúng token; Customer không có quyền.
- Không chọn được món, `RECIPE_UNAVAILABLE` hoặc `INSUFFICIENT_INGREDIENTS`:
  kiểm tra công thức và tồn kho. Seed chỉ tạo dữ liệu thiếu; không reset tồn cũ.
- `SMS_NOT_CONFIGURED`: cấu hình eSMS hoặc bật demo local như trên. Nếu register
  đã tạo tài khoản pending, dùng Resend OTP sau khi sửa cấu hình thay vì đăng ký lại.
- `IDEMPOTENCY_KEY_REUSED`: key cũ đi kèm nội dung khác; dùng đúng payload cũ để
  retry, hoặc bắt đầu phiên mới cho một giao dịch mới.

Muốn sửa collection từ mã nguồn rồi xuất lại hai file JSON:

```powershell
node backend/postman/build-collection.mjs
```

Lệnh này ghi đè hai file template trong repo; không thay environment đã import
trong Postman. File trong repo chỉ chứa thông tin local demo và token rỗng.

Lần chạy đầy đủ đã thực hiện **65 request của collection, 91 assertions PASS,
0 lỗi** bằng Postman CLI. CLI ghi 66 HTTP requests vì có thêm một request đến
ngân hàng mô phỏng. OTP và ngân hàng VNPAY dùng mô phỏng local trong database
kiểm thử riêng. Xem [báo cáo kết quả](reports/latest-run.md).
