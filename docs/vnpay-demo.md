# Hướng Dẫn Chạy Demo Thanh Toán VNPAY & Điểm Thưởng BrewLite

Tài liệu này hướng dẫn cách cấu hình, khởi chạy và demo đầy đủ quy trình tích hợp cổng thanh toán **VNPAY Sandbox** và hệ thống **điểm thưởng (Loyalty Points)** cho dự án BrewLite.

---

## 1. Tổng quan tính năng (Bạn 02)

1. **Cashless 100% qua VNPAY**: Giao diện thanh toán chỉ chấp nhận VNPAY (mã QR động sinh bởi cổng VNPAY, ứng dụng ngân hàng, thẻ ATM, Visa/Master). Không sử dụng QR giả lập tự vẽ trong ứng dụng.
2. **Chào mừng thành viên mới**: Mọi tài khoản mới đăng ký tự động được tặng **500 điểm thưởng** (`WELCOME_POINTS = 500`).
3. **Quy tắc tích điểm**:
   - Tỷ lệ: **1.000đ = 1 điểm** (`VND_PER_LOYALTY_POINT = 1000`), làm tròn xuống (`Math.floor(Order.total / 1000)`).
   - Điểm thưởng **chỉ được cộng vào ví khách hàng khi đơn hàng đạt trạng thái `COMPLETED`** (do Barista hoàn thành pha chế), không cộng lúc thanh toán để đảm bảo an toàn kế toán và chống gian lận.
4. **An toàn & Idempotency**:
   - Sử dụng chữ ký `vnp_SecureHash` (HMAC-SHA512) theo chuẩn mã hóa của VNPAY.
   - Chống replay attack bằng `Idempotency-Key` và `Payment_one_active_per_order`.
   - Đối soát tự động định kỳ (`VnpayReconcileJob`) và truy vấn trạng thái qua Web API (`querydr`).
   - Xử lý hoàn kho và hoàn tiền (`PaymentRefund`) cho Barista khi hủy đơn hoặc IPN trễ khi đơn đã hủy (`NEEDS_REFUND`).

---

## 2. Cấu hình môi trường (.env)

### Backend (`backend/.env`)

```env
PORT=4000
NODE_ENV=development
DATABASE_URL="postgresql://brewlite:brewlite@localhost:5432/brewlite"
TEST_DATABASE_URL="postgresql://brewlite:brewlite@localhost:5432/brewlite_test"
JWT_SECRET="brewlite-jwt-secret-demo-2026"
JWT_EXPIRES_IN="1d"

# Thông tin VNPAY Merchant Sandbox (Test)
VNPAY_TMN_CODE="FZL3EVU2"
VNPAY_HASH_SECRET="AAKZTEDEWXLKWYGJCFJQQIZGJYXUZDDL"
VNPAY_PAY_URL="https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
VNPAY_API_URL="https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"
VNPAY_RETURN_URL="http://localhost:3000/payment/vnpay-return"
PAYMENT_EXPIRE_MINUTES=15
PAYMENT_MOCK_ENABLED=true
TRUST_PROXY=false
```

### Frontend (`frontend/.env.local`)

```env
BACKEND_API_URL=http://127.0.0.1:4000/api
```

---

## 3. Khởi chạy hệ thống

### Bước 1: Khởi động cơ sở dữ liệu PostgreSQL
```bash
docker-compose up -d
```

### Bước 2: Deploy Migration & Seed dữ liệu mẫu
```bash
cd backend
npx prisma migrate deploy
npm run seed
```

### Bước 3: Chạy Backend (Port 4000)
```bash
cd backend
npm run start:dev
```

### Bước 4: Chạy Frontend (Port 3000)
```bash
cd frontend
npm run dev
```

Truy cập hệ thống tại: `http://localhost:3000`

---

## 4. Kịch bản chạy Demo chi tiết

### Kịch bản 1: Đăng ký & Nhận 500 điểm thưởng chào mừng
1. Truy cập `http://localhost:3000/register`.
2. Đăng ký tài khoản mới (ví dụ: `khachhang@example.com` / `Password@123`).
3. Đăng nhập thành công, quan sát góc phải thanh điều hướng hoặc vào `/orders`:
   - Số điểm ban đầu hiển thị: **500 điểm**.

### Kịch bản 2: Đặt món & Thanh toán VNPAY (Có mã QR thật của VNPAY)
1. Vào `http://localhost:3000/menu`, chọn các món nước và topping vào giỏ hàng.
2. Vào `http://localhost:3000/cart`, kiểm tra tóm tắt chi phí và dòng "Tích lũy dự kiến (khi hoàn thành)".
3. Nhấn "Tiến hành đặt hàng" để sang trang `/checkout`:
   - Phương thức thanh toán hiển thị duy nhất: **Cổng thanh toán VNPAY (Cashless 100%)**.
4. Nhấn **"Xác Nhận Thanh Toán"**:
   - Trình duyệt tự động chuyển hướng sang cổng thanh toán chính thức của VNPAY Sandbox: `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...`.
   - Trang VNPAY hiển thị **Mã QR động do VNPAY sinh ra** cùng các lựa chọn thanh toán:
     - Ứng dụng thanh toán hỗ trợ VNPAY-QR.
     - Thẻ nội địa và tài khoản ngân hàng.
     - Thẻ quốc tế (Visa, MasterCard, JCB).
5. Để thanh toán demo, chọn **Thẻ nội địa & tài khoản ngân hàng**, chọn ngân hàng **NCB** và nhập thông tin thẻ test sandbox:
   - **Số thẻ**: `9704198526191432152`
   - **Tên chủ thẻ**: `NGUYEN VAN A`
   - **Ngày phát hành**: `07/15`
   - **Mật khẩu OTP**: `123456`
6. Nhấn xác nhận, VNPAY chuyển hướng về trang Return URL của ứng dụng: `http://localhost:3000/payment/vnpay-return`.
   - Hệ thống tự động xác thực chữ ký và đối soát giao dịch với VNPAY API (`querydr`).
   - Màn hình hiển thị: **Giao dịch VNPAY hoàn tất! Mã đơn hàng #...**.
   - Giỏ hàng tự động được dọn sạch.
   - Điểm số tài khoản lúc này **vẫn giữ nguyên 500 điểm** (chưa cộng vì đơn mới ở trạng thái `PAID`).

### Kịch bản 3: Barista hoàn thành đơn & Tích điểm vào tài khoản
1. Mở cửa sổ ẩn danh hoặc đăng nhập bằng tài khoản Barista: `barista@brewlite.vn` / mật khẩu trong seed.
2. Truy cập trang điều phối pha chế: `http://localhost:3000/barista`.
3. Tìm đơn hàng vừa thanh toán, chuyển trạng thái theo đúng quy trình:
   - `PAID` ➔ `PREPARING` (Đang pha chế)
   - `PREPARING` ➔ `READY` (Đã pha xong, chờ lấy)
   - `READY` ➔ `COMPLETED` (Đã giao khách hàng)
4. Ngay khi chuyển sang `COMPLETED`:
   - Transaction xử lý cộng điểm tích lũy: `Math.floor(Order.total / 1000)`.
   - Quay lại tài khoản khách hàng và làm mới trang: điểm tích lũy tăng thêm tương ứng (ví dụ: đơn 50.000đ ➔ tài khoản có `500 + 50 = 550 điểm`).
   - Sổ cái điểm ghi nhận giao dịch `LoyaltyTransaction` loại `EARN` với `eventKey: "order:{id}:earn"`.

### Kịch bản 4: Hủy đơn hàng & Hoàn tiền (PaymentRefund)
1. Khách hàng vào `/orders`, chọn đơn hàng có trạng thái `PAID` và bấm **"Hủy đơn hàng này"**.
2. Hệ thống:
   - Hủy đơn: `status = CANCELLED`.
   - Giải phóng nguyên liệu đã giữ trong kho (`inventory.finish(tx, id, false)`).
   - Tạo bản ghi `PaymentRefund` với trạng thái `PENDING` và cập nhật thanh toán thành `NEEDS_REFUND`.
3. Barista có quyền gọi API hoàn tiền: `POST /api/payments/:id/refund` để kích hoạt hoàn tiền qua cổng VNPAY Web API. Sau khi hoàn tất, giao dịch được đánh dấu `Đã hoàn tiền`.

---

## 5. Cấu hình Tunnel nhận Webhook IPN thực từ VNPAY (Tùy chọn)

Cổng VNPAY Sandbox gửi Webhook IPN từ máy chủ của VNPAY đến backend của bạn. Khi chạy máy local, bạn có thể dùng `cloudflared` hoặc `ngrok`:

```bash
# Sử dụng cloudflared (miễn phí, không cần tài khoản)
cloudflared tunnel --url http://localhost:4000
```
Hoặc dùng `ngrok`:
```bash
ngrok http 4000
```

Copy đường dẫn HTTPS công khai (ví dụ `https://your-tunnel.trycloudflare.com`) và cấu hình trên trang quản trị Merchant VNPAY:
`https://your-tunnel.trycloudflare.com/api/payments/vnpay/ipn`.

Backend BrewLite đã xử lý đầy đủ:
- Xác thực chữ ký `vnp_SecureHash`.
- Kiểm tra tính toàn vẹn số tiền (`RspCode: "04"` nếu sai lệch).
- Kiểm tra trùng lặp (`RspCode: "02"` nếu đã ghi nhận trước đó).
- Xử lý đơn hàng đã hủy trước đó (`RspCode: "00"`, chuyển sang `NEEDS_REFUND` để hoàn tiền).

