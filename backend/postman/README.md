# BrewLite Postman — giống Swagger Docker 4001

Collection có đúng **44 endpoint**, chia thành 10 mục ngoài cùng giống Swagger:
App, ingredients, products, inventory, auth, admin/staff, orders, payments,
promotions, Health. Các nhóm demo 00–08 và lớp bọc 09 đã được bỏ.

## Import và đăng nhập

1. Import `BrewLite.postman_collection.json`, thay thế collection cũ.
2. Giữ environment `BrewLite Docker 4001` hiện có, hoặc chọn No Environment.
   `base_url` phải là `http://127.0.0.1:4001/api`.
3. Mở **auth → POST /api/auth/login** và Send để đăng nhập Customer.
4. Đổi biến collection `login_role` thành `BARISTA`, Send lại cùng request để
   lưu token Barista. Mở **admin/staff → POST /api/admin/staff** để cấp tài khoản
   nhân viên bằng token Barista vừa lưu. Tài khoản mới có role `STAFF`, không có
   quyền tạo/xóa nhân viên. POST lưu `staff_id` để dùng cho DELETE.

Biến environment được ưu tiên hơn biến collection. Nếu đã tự thêm `login_role`
trong environment, hãy sửa tại đó. Không cần import lại environment cũ; login
tự lưu token vào environment được chọn hoặc collection khi chọn No Environment.

`login_role=CUSTOMER` giữ body đang hiển thị để bạn sửa email/phone và password
nếu cần. `BARISTA` lấy `barista_email` / `barista_password`; `STAFF` lấy
`staff_phone` / `staff_password` và thay body khi gửi.
Chỉ gửi một trong email hoặc phone. Customer/Barista mặc định dùng thông tin
demo local trong collection.

Token tự lưu theo vai trò: `customer_token`, `barista_token`, `staff_token`.
`GET /api/auth/me` dùng `auth_token` của lần đăng nhập/xác thực OTP gần nhất.
Mỗi request khác đã chọn đúng token theo quyền backend cổng 4001.

Postman lưu riêng từng token: đổi `login_role` không tự đổi Authorization của
các request khác. Để thử STAFF bị chặn tạo/xóa, vào Authorization của POST hoặc
DELETE admin/staff, tạm đổi Bearer Token từ `{{barista_token}}` thành
`{{staff_token}}`, Send và mong đợi **403**. Sau đó đổi lại `{{barista_token}}`.
Để thử nghiệp vụ bằng nhân viên, dùng `{{staff_token}}` tại request tương ứng.

## Lấy dữ liệu để gửi từng API

- **products → GET /api/products** tự lưu `product_id` và `size` của sản phẩm
  còn nguyên liệu nếu chưa chọn ID. Nếu không có món khả dụng, cần nhập ID/size
  phù hợp sau khi cấu hình công thức và tồn kho.
- **ingredients → GET /api/inventory/ingredients** tự lưu `ingredient_id` đầu
  tiên nếu biến đang trống; danh sách kho cần token Barista.
- **products → GET /api/products/toppings** tự lưu `topping_id` nếu chưa có.
- Các request POST tạo nguyên liệu/topping/sản phẩm/đơn hàng/thanh toán tự lưu
  ID mới vào biến tương ứng. GET danh sách không ghi đè ID bạn đã chọn.
- Có thể sửa ID trực tiếp trong Variables để xem/cập nhật bản ghi khác.
- Body mẫu chứa các trường cần thiết; mô tả request có schema đầy đủ và các
  trường tùy chọn. Bộ lọc query không có mặc định được bỏ chọn trong Params.

Gửi từng request như Try it out của Swagger. Thứ tự nhóm không phải thứ tự
nghiệp vụ: thanh toán cần đơn hợp lệ, chuyển trạng thái cần đơn đã trả tiền,
recipe cần nguyên liệu, tạo nhân viên cần Barista. API 4001 dùng chung dữ liệu
với website cổng 3001; không Run toàn bộ collection theo thứ tự nhóm.

Các request có `Idempotency-Key` tự sinh khóa lần đầu, giữ nguyên cho retry.
Giữ cùng body/key khi gửi lại; muốn tạo giao dịch mới, xóa `order_key`,
`payment_key`, `receipt_key` hoặc `adjustment_key` tương ứng trước khi Send.

## OTP

Đăng ký Customer dùng `register_phone`, `register_password`. Điền `otp_code`
nhận được rồi gọi verify-otp. Resend cần chờ ít nhất 60 giây. OTP theo cấu hình
SMS backend, không mặc định 123456. Barista cấp STAFF đã xác thực qua
POST /api/admin/staff; nhân viên này đăng nhập ngay, không phải xác thực OTP.

## Xóa tài khoản nhân viên và phân quyền

`BARISTA` tạo/xóa nhân viên; `STAFF` dùng các API nghiệp vụ sản phẩm, kho,
đơn hàng và thanh toán như Barista nhưng không quản lý tài khoản nhân viên.
`CUSTOMER` và `STAFF` nhận 403 khi gọi POST/DELETE admin/staff.

Để test: đăng nhập BARISTA, tạo nhân viên bằng POST, đổi `login_role=STAFF`
đăng nhập nhân viên mới, rồi gọi GET /auth/me để thấy role STAFF. Đổi lại
`login_role=BARISTA` khi cần quản lý tài khoản.

Gọi **DELETE /api/admin/staff/{{staff_id}}**, không có body, dùng `barista_token`.
API trả 200 với `{ "id": ..., "deleted": true }`. Chỉ xóa STAFF; ID không tồn
tại, đã xóa hoặc thuộc Customer/Barista/Manager trả 404. Không thể xóa chính
tài khoản Barista đang quản lý.

Xóa mềm bằng `deletedAt` để giữ lịch sử đơn hàng, thanh toán và kho. Tài khoản
bị xóa không đăng nhập được, token cũ nhận 401. SĐT/email vẫn được giữ để bảo
toàn lịch sử và không tái sử dụng. Các tài khoản BARISTA có trước thay đổi này
giữ nguyên vai trò; nhân viên tạo mới mới mang role STAFF.

## VNPAY

POST /api/payments mặc định tạo URL VNPAY, lưu `vnpay_payment_url`; mở URL để
thanh toán sandbox đã cấu hình. Mock WALLET/CARD chỉ chạy khi backend cho phép.
IPN/return dùng biến `vnpay_callback_query`: toàn bộ query thật sau dấu `?` của
callback, giữ nguyên giá trị/chữ ký và URL encoding. Không dùng query của URL
khởi tạo thanh toán. Return cần token khách sở hữu giao dịch. Không đưa hash
secret vào Postman. Refund chỉ gửi cho giao dịch đủ điều kiện hoàn tiền.

## Kiểm tra và đồng bộ

Từ thư mục gốc dự án:

```powershell
node backend/postman/verify-swagger.mjs
node backend/postman/sync-swagger.mjs
```

`verify-swagger.mjs` kiểm tra method/path, nhóm, auth, schema body, query/header,
biến và cú pháp script của toàn bộ collection. `sync-swagger.mjs` lấy Swagger
đang chạy ở cổng 4001, cập nhật snapshot và collection; giữ environment hiện có.

Tạo collection offline từ `BrewLite.openapi.json`:

```powershell
node backend/postman/build-collection.mjs --collection-only
```

Bỏ `--collection-only` sẽ tạo lại cả environment template với token rỗng.

Chạy kiểm thử tích hợp toàn bộ endpoint trên database local riêng:

```powershell
node backend/postman/run-full.mjs
```

Cần backend đã build (`cd backend`, `npm.cmd run build`), PostgreSQL local và
Postman CLI trên PATH (hoặc đặt `POSTMAN_CLI`). Runner tạo database
`brewlite_postman_*`, migrate/seed, chạy API 4010 và ngân hàng mô phỏng 4011.
`integration-scenario.mjs` lấy chính 44 request đã export để tạo 57 bước theo
đúng quan hệ dữ liệu/trạng thái. Runner kiểm tra chữ ký VNPAY, IPN sai/trùng,
return và refund; SMS và ngân hàng được mô phỏng local. OTP resend vẫn chờ
61 giây thật. Không thay cấu hình SMS/VNPAY hay dữ liệu Docker 4001.

Kết quả ở `reports/latest-run.md` / `latest-run.json`; log và collection chạy
thử ở `.local-backups/postman-runs/`. Database test được giữ để kiểm tra; API
và mock gateway dừng khi kết thúc. `--serve` giữ dịch vụ và xuất collection
kiểm thử để import thủ công, Ctrl+C để dừng. Đây không phải xác nhận gửi SMS
thật hay thanh toán ngân hàng thật.
