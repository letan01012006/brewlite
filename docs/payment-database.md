# Database thanh toán VNPAY và điểm — BrewLite

Ngày kiểm chứng: **05/11/2026 (Asia/Ho_Chi_Minh)**. Phạm vi: Prisma schema, migration, kiểm thử SQL và bàn giao. Chưa triển khai gateway, IPN/Return handler, tính điểm, hoàn tiền hoặc frontend. Không có merchant secret trong schema, SQL hay seed.

## 1. Hiện trạng đã xác minh

- Checkout: `main`, commit ban đầu `ffcd28c`; working tree sạch trước khi sửa. Không chuyển nhánh, reset Git, sửa 5 migration đã có, chạy seed trên nguồn hoặc chỉnh số dư.
- `backend/.env` trỏ tới **localhost:5432/brewlite_rebuild**, được chủ dự án xác nhận là nguồn. PostgreSQL 16.15, container `brewlite-db-1`. Docker và container PostgreSQL được khởi động để đọc/backup; backend và frontend không được khởi động.
- `docker-compose.yml` mặc định dùng database `brewlite`. Đây **không phải nguồn** trong lần kiểm chứng này. Các database `brewlite_clone`, `brewlite_rebuild_test_*`, `brewlite_ingredient_test_*`, `brewlite_topping_test_*` đã có từ trước, không được dùng làm nguồn hay bị xóa.
- Repository hiện có 5 migration cũ, nhưng nguồn có 7 bản ghi đã hoàn thành. SHA-256 của cả 5 file đang có khớp database.

Hai migration trong nguồn nhưng không còn trong checkout:

| Migration | SHA-256 lưu trong nguồn |
| --- | --- |
| `20261104075247_payment_points` | `aa4341cf0c8eed5ed7272b4ff27bd2902b4502904374ad2b8884d26b70f4f36d` |
| `20261104075638_sync` | `a7f8fcb9b87e5a2cde2b68488b9d79648904ce98b94252a002ca9d154b2f2ad3` |

Commit `832c885` còn SQL lịch sử của hai migration này. Cả hai cùng khai báo tạo `Payment_gatewayTxnRef_key`, nên chép chúng trở lại chuỗi hiện tại sẽ tái tạo lỗi duplicate index. Bản `sync` trong Git cũng không khớp checksum đã áp dụng ở nguồn. Không đưa chúng lại vào thư mục migration đang chạy, không sửa checksum hay xóa bản ghi `_prisma_migrations`.

**Giải pháp lần này:** thêm hai migration tiến về trước, hỗ trợ schema 5 migration của checkout và cấu trúc 7 migration thực tế đã được kiểm tra. Bản sao nguồn giữ nguyên 7 bản ghi lịch sử và thêm 2 bản ghi mới. Lịch sử thiếu file vẫn được ghi nhận trung thực; đây không phải việc khôi phục hoàn chỉnh lịch sử migration. Trước khi dùng `migrate dev` với nguồn/bản sao nguồn, cần tìm đúng SQL lịch sử đã áp dụng hoặc thống nhất một quy trình baseline riêng. Không dùng đề nghị reset để xử lý khoảng trống lịch sử này.

Tham khảo [schema repo mẫu tại commit 02a2de55](https://github.com/Tiendatsharkd1211/Brewlite/blob/02a2de55eab95f7206d5a8732880e510252229a6/brewlite/backend/prisma/schema.prisma): các nhóm thông tin link VNPAY, kết quả cổng, nhật ký và `NEEDS_REFUND`. BrewLite giữ ID `Int`, tên bảng, `SUCCESS` và các enum cũ.

## 2. Sao lưu và môi trường thử

Backup nguồn dạng PostgreSQL custom:

```text
.local-backups/brewlite_payment_source_20261105.dump
82,047 bytes
SHA-256: d7fb2155e6d3e72cc8de971d188f2a0a7d9c2fde300175288bf554ad1c88bd77
```

Đã đọc được bằng `pg_restore --list` và restore với `--exit-on-error` vào database mới. Thư mục `.local-backups/` được Git bỏ qua; backup chứa dữ liệu thật, cần giữ ở nơi riêng tư. Không commit file dump.

| Database | Vai trò / kết quả |
| --- | --- |
| `brewlite_rebuild` | Nguồn; **chưa áp dụng migration mới**; kiểm thử chỉ kết nối với `default_transaction_read_only=on` |
| `brewlite_payment_test_20261105` | Database riêng cho schema trắng và fixture cũ; các schema `payment_fresh_*`, `payment_old_*` được giữ để kiểm tra |
| `brewlite_payment_copy_20261105` | Restore và nâng cấp thử lần đầu; diff Prisma không có khác biệt |
| `brewlite_payment_verified_20261105` | Restore mới từ cùng backup; nâng cấp và kiểm chứng cuối cùng đạt 12/12 |

Schema dùng ở lần kiểm chứng cuối: `payment_fresh_46b58cc311e84964a2321b5f359c791b` và `payment_old_46b58cc311e84964a2321b5f359c791b` trong database test. Một schema của lần thử đầu còn lịch sử migration thất bại; không dùng schema đó làm bằng chứng triển khai cuối cùng hoặc làm database nguồn. Không xóa database/volume để chạy lại.

## 3. Model và ý nghĩa dữ liệu

### Enum

| Enum | Giá trị / ý nghĩa |
| --- | --- |
| `PaymentMethod` | Giữ `WALLET`, `CARD`; thêm `VNPAY`, `POINTS` |
| `PaymentStatus` | Giữ `PROCESSING`, `SUCCESS`, `FAILED`; bảo toàn `EXPIRED`, `CANCELLED` đang có ở nguồn; thêm `NEEDS_REFUND` |
| `RefundStatus` | `PENDING` = đã yêu cầu; `PROCESSING` = đang thực hiện; `SUCCESS` = đã xác nhận hoàn; `FAILED` = thất bại, có thể thử lại cùng yêu cầu |
| `LoyaltyTransactionType` | `EARN`, `REDEEM`, `REFUND`, `REVOKE`; giữ `ADJUSTMENT` của nguồn cho dữ liệu/điều chỉnh có kiểm soát |
| `PaymentEventSource` | `CREATE`, `IPN`, `RETURN`, `QUERY`, `REFUND` |
| `PaymentEventResult` | `RECEIVED`, `ACCEPTED`, `REJECTED`, `ERROR`, `DUPLICATE`; kết quả xử lý sự kiện, không đồng nghĩa với trạng thái thu tiền |

`FAILED`/`EXPIRED`/`CANCELLED` không chứng minh cổng chưa thu tiền. Nếu kết quả xác thực đến muộn cho biết đã thu nhưng đơn không thể nhận thanh toán này, backend phải ghi `NEEDS_REFUND`. Không đổi thành `SUCCESS` khi một giao dịch khác đã thanh toán đơn.

### Payment

Mỗi dòng là một lần thanh toán toàn bộ đơn; một đơn có thể có nhiều lần thất bại. `Order.payments` vẫn là danh sách.

| Trường / nhóm | Quy ước |
| --- | --- |
| `id`, `orderId` | ID `Int`; FK kết hợp `(orderId, amount)` tới `(Order.id, Order.total)` buộc thanh toán toàn bộ giá trị đơn |
| `amount` | Số nguyên VND, không phải số đã nhân 100 để gửi cổng; không âm. Khi `POINTS`, vẫn là giá trị VND của toàn bộ đơn |
| `pointsUsed` | Số **điểm**, nguyên dương khi `POINTS`; bằng 0 ở phương thức khác. Chỉ lưu snapshot số điểm cần dùng tại Payment, không thêm `Order.pointsUsed` |
| `idempotencyKey`, `requestHash` | Khóa tạo thanh toán duy nhất và hash của yêu cầu chuẩn hóa; cùng khóa nhưng hash khác phải bị backend từ chối |
| `gatewayTxnRef` | `vnp_TxnRef` do ứng dụng tạo cho **giao dịch VNPAY mới**, unique khi khác NULL; không tự backfill mã cho giao dịch cũ |
| `paymentUrl` | Link thanh toán để dùng lại tới hạn; chỉ trả cho người được phép xem thanh toán |
| `gatewayCreatedAt`, `expiresAt` | Thời điểm tạo yêu cầu cổng và hết hạn dạng DateTime; nếu có thời điểm tạo thì phải có hạn lớn hơn thời điểm tạo |
| `vnpCreateDate` | Chuỗi chính xác 14 chữ số gửi cổng, dùng lại khi query/reconcile; không tái dựng từ `createdAt` |
| `providerRef` | Mã giao dịch VNPAY trả về (`vnp_TransactionNo`); dùng trường có sẵn. Unique theo `(method, providerRef)` khi có giá trị |
| `gatewayBankCode`, `bankTransactionNo`, `cardType` | Mã ngân hàng, mã giao dịch ngân hàng, loại thanh toán |
| `gatewayResponseCode`, `gatewayTransactionStatus` | Mã phản hồi và trạng thái giao dịch từ cổng, giữ dạng chuỗi để không mất số 0 ở đầu |
| `vnpPayDate`, `paidAt` | Chuỗi ngày thanh toán 14 chữ số và thời điểm đã chuyển đổi. Prisma `paidAt` ánh xạ cột **`gatewayPayDate`** đã có, không tạo thêm cột ngày trùng ý nghĩa |
| `ipnProcessedAt` | Thời điểm backend đã xử lý IPN hợp lệ; không dùng cột này làm khóa chống lặp độc lập |
| `failureReason`, `responseSnapshot` | Lý do lỗi và snapshot kết quả đã lọc thông tin nhạy cảm; tái sử dụng các trường sẵn có |
| `refundedAt`, `refundedAmount`, `refundRef` | Bằng chứng **đã hoàn**: thời điểm, lượng VND đã hoàn, mã xác nhận. Mặc định NULL/0/NULL. Không ghi vì khách mới yêu cầu hủy |
| `createdAt`, `updatedAt` | Thời điểm tạo/cập nhật bản ghi, khác thời điểm nghiệp vụ từ cổng |

Thời gian DateTime theo quy ước UTC của ứng dụng; cột vật lý theo dự án là `TIMESTAMP(3)`. Hai chuỗi `vnpCreateDate`/`vnpPayDate` theo giờ Việt Nam; CHECK chỉ kiểm tra 14 chữ số, backend phải kiểm tra ngày lịch thực sự và chuyển múi giờ đúng. Backend cũng phải xử lý quy đổi đơn vị VND sang đơn vị giao thức cổng.

Các cột `Payment.pointsAmount`, `Payment.gatewayTransactionNo` và `LoyaltyTransaction.pointsAmount` **đã tồn tại trong nguồn** nên được bảo toàn trong schema đích. `pointsAmount` là snapshot tiền di sản, không phải điểm hay số dư; giữ 0 trong luồng mới. Nếu có giá trị tiền khác 0 tại Payment thì chỉ chấp nhận toàn bộ `amount` của phương thức `POINTS`. `gatewayTransactionNo` tại Payment chỉ đọc dữ liệu cũ; luồng mới ghi mã cổng vào `providerRef`, không ghi song song hai cột. Không tự chuyển đổi hoặc xóa giá trị cũ khi chưa đối soát. `PaymentWebhookLog.gatewayTransactionNo` là thông tin của từng sự kiện, không phải nguồn trạng thái chuẩn của Payment.

Không cố định tỷ giá điểm trong migration. Cặp `amount`/`pointsUsed` lưu đủ giá trị của giao dịch tại thời điểm chốt. Bạn 2 cần quyết định tỷ giá, quy tắc làm tròn và kiểm tra đủ điểm; không hiểu mặc định 1 điểm = 1 VND. Chưa hỗ trợ trộn điểm với VNPAY.

### LoyaltyTransaction

`User.loyaltyPoints` tiếp tục là số dư hiện tại, CHECK không âm. `LoyaltyTransaction` là bảng lịch sử duy nhất; không có bảng sổ điểm thứ hai. Quan hệ `Order.loyaltyTransaction?` đổi thành **`Order.loyaltyTransactions[]`**.

| Loại | Dấu `points` | Liên kết / khóa gợi ý cho backend |
| --- | --- | --- |
| `EARN` | Dương; 0 vẫn được chấp nhận để giữ dòng cũ | Một lần/đơn; `order:<id>:earn` |
| `REDEEM` | Âm | Bắt buộc `paymentId`; `payment:<id>:redeem` |
| `REFUND` | Dương | Bắt buộc `paymentId`, `relatedTransactionId` trỏ dòng REDEEM; `payment:<id>:refund` |
| `REVOKE` | Âm | Bắt buộc `relatedTransactionId` trỏ dòng EARN; `loyalty:<earnId>:revoke` |
| `ADJUSTMENT` | Khác 0 | Chỉ luồng điều chỉnh được kiểm soát, có khóa sự kiện ổn định |

`eventKey` bắt buộc, không rỗng và unique. Migration gán `legacy:loyalty:<id>` cho dòng cũ; prefix `legacy:` dành riêng cho migration. `type` mặc định `EARN` tương thích dữ liệu ban đầu. `paymentId` nullable để giữ EARN cũ không gắn giao dịch.

FK kép bảo đảm người dùng đúng chủ đơn, payment thuộc đúng đơn; FK ba cột bảo đảm dòng tham chiếu hoàn/thu hồi cùng đơn và người dùng, không tự tham chiếu chính mình. Backend vẫn phải kiểm tra **loại dòng gốc**, đúng phương thức POINTS, số điểm hoàn/thu hồi không vượt dòng gốc và `pointsUsed` khớp REDEEM. FK không kiểm tra các ý nghĩa nghiệp vụ này.

`reversedAt` cũ được giữ nguyên và `points` của dòng EARN cũ không đổi dấu. Không tự tạo dòng REVOKE cho các EARN đã có `reversedAt`; nếu làm vậy và trừ điểm lần nữa sẽ thu hồi lặp. Luồng mới nên ghi dòng REVOKE; khi gặp dữ liệu cũ phải nhận biết dấu đã thu hồi. Không tính lại số dư bằng `SUM(points)` vì lịch sử cũ chưa đầy đủ và EARN cũ có thể đã bị đảo bằng `reversedAt`.

### Nhật ký PaymentWebhookLog

Tận dụng tên bảng đã tồn tại ở nguồn cho toàn bộ CREATE/IPN/RETURN/QUERY/REFUND. `Payment.events` trỏ tới bảng này.

- `id`, `paymentId?`: ID `Int`; FK Restrict giữ dấu vết. Cho phép chưa tìm được Payment để ghi IPN không xác định.
- `source`, `result`, `message`: nguồn, kết quả xử lý, thông báo đã lọc. Dòng cũ mặc định `IPN`/`RECEIVED`, không tự suy diễn là xử lý thành công.
- `occurredAt`, `createdAt`: thời gian sự kiện và thời gian ghi; backend cung cấp thời gian sự kiện đáng tin cậy khi có. Mặc định now giúp nâng cấp được dữ liệu cũ.
- `gatewayTxnRef`, `gatewayTransactionNo`, `amount`, `responseCode`, `signatureValid`, `processed`: bằng chứng từng lần trao đổi. `amount` là VND chuẩn hóa, nullable khi chưa đọc được số tiền; không lưu giá trị âm.
- `rawPayload`: tên cũ được giữ, **chỉ nhận object đã lọc bằng allowlist**. `requestId?` dùng tương quan các lần gọi, không unique; mỗi IPN lặp vẫn có thể có một dòng log.

Không lưu merchant secret, authorization/cookie/header, access token, thông tin thẻ/tài khoản đầy đủ hoặc payload callback nguyên bản. Loại `vnp_SecureHash`/`vnp_SecureHashType` khỏi log và snapshot. Link thanh toán có thể chứa chữ ký theo giao thức; chỉ lưu ở `paymentUrl` để trả lại đúng người dùng, không nhân bản vào log. Schema không tự lọc JSON; bạn 2 phải thực hiện trước khi ghi và giới hạn quyền đọc/retention. `signatureValid=true` chỉ sau khi backend xác thực thực sự.

### PaymentRefund

Tận dụng bảng đã có ở nguồn để giữ vòng đời yêu cầu; không mở cấu trúc nhiều lần hoàn từng phần.

- `paymentId @unique`: tối đa một yêu cầu hoàn toàn bộ cho mỗi Payment; retry cập nhật cùng dòng.
- `amount`: lượng VND **yêu cầu**, dương; FK `(paymentId, amount)` buộc bằng toàn bộ `Payment.amount`.
- `idempotencyKey @unique`: khóa yêu cầu ổn định, không rỗng; dòng cũ nhận `legacy:refund:<id>`.
- `status`: PENDING → PROCESSING → SUCCESS/FAILED do backend quản lý. `failureReason`, `gatewayResponseCode` ghi lỗi/phản hồi.
- `gatewayRefundNo` là mã cổng trong hồ sơ yêu cầu; khi đã xác nhận, đồng bộ bằng chứng vào `Payment.refundRef`. `confirmedAt` bắt buộc khi SUCCESS và phải NULL ở trạng thái khác.
- `createdAt`, `updatedAt`: thời gian yêu cầu/cập nhật. Quan hệ Prisma là `Payment.refunds[]` để tránh thêm index kép dư thừa cho quan hệ 1-1; database vẫn giới hạn duy nhất bằng `paymentId`.

Chỉ sau bằng chứng hoàn thành đáng tin cậy mới cập nhật `PaymentRefund.status=SUCCESS`, `confirmedAt` và `Payment.refundedAt/refundedAmount/refundRef` trong cùng transaction. Database không gọi ngân hàng hay tự xác nhận hoàn tiền; cũng không tự đồng bộ hai bản ghi. Các trường đã hoàn của Payment vẫn là nguồn chuẩn của số tiền đã hoàn. Bản ghi hoàn mock cũ được giữ, không tự biến thành một yêu cầu hoàn VNPAY mới.

## 4. Ràng buộc, index và giới hạn

Các CHECK cũ về giá, tiền, điểm, đơn hàng và kho tiếp tục tồn tại. Bổ sung:

- Payment có số điểm đúng phương thức, không dùng điểm âm hoặc chia nhỏ tiền thanh toán; FK bảo đảm amount bằng tổng đơn.
- Khoản đã hoàn phải có thời điểm xác nhận, bằng toàn bộ amount, và payment ở SUCCESS/NEEDS_REFUND. Khi chưa hoàn: `refundedAt IS NULL`, `refundedAmount=0`.
- Lịch sử điểm có dấu theo loại, khóa không rỗng, ràng buộc tham chiếu và chống tự đảo.
- Mỗi payment chỉ có một dòng mỗi loại điểm: unique `(paymentId, type)`; NULL payment không chặn EARN cũ. Có thêm partial unique một EARN/đơn và một REVOKE/dòng gốc.
- PaymentRefund một dòng/payment; khóa yêu cầu unique; trạng thái/thời gian xác nhận nhất quán.
- Log có FK và lượng tiền không âm nếu có.

**`Payment_one_active_per_order` giữ nguyên predicate `status IN ('PROCESSING','SUCCESS')`.** NEEDS_REFUND phải nằm ngoài: giao dịch cũ đến muộn có thể cần hoàn khi đơn đã có SUCCESS/PROCESSING khác. Đưa NEEDS_REFUND vào index sẽ ngăn lưu chính trường hợp này. Backend phải khóa Order khi chốt giao dịch; không thể chỉ dựa vào index để xử lý race.

Index Prisma và SQL đã được kiểm tra bằng `migrate diff`. Các index thường bao phủ tra cứu theo order/status, status/expiresAt, user/time, order/time, payment/type, dòng gốc và nguồn/thời gian log. Các composite unique ở Order/Payment phục vụ FK tài chính và tính nhất quán quan hệ.

Prisma 6 không biểu diễn CHECK và partial index. Ba partial index quản lý bằng SQL là `Payment_one_active_per_order`, `LoyaltyTransaction_one_earn_per_order`, `LoyaltyTransaction_one_revoke_per_earn`; không khai báo thêm một index Prisma trùng tên. `LoyaltyTransaction_one_refund_per_payment` cũ được thay bằng unique `(paymentId,type)` bao quát các loại.

Chuỗi 7 migration hiện tại chỉ có **một** lệnh tạo `Payment_gatewayTxnRef_key`, có kiểm tra index hiện hữu là unique hợp lệ trên đúng một cột, không partial. Bản sao nguồn đã có unique index này nên không tạo lại. Index thường dư `Payment_gatewayTxnRef_idx` được loại bỏ, không ảnh hưởng dữ liệu.

Database bảo vệ hình dạng dữ liệu; bạn 2 chịu trách nhiệm state machine, xác thực cổng, khóa đồng thời, kiểm tra tỷ giá/đủ điểm, liên kết đúng loại biến động và cập nhật số dư + lịch sử + trạng thái nguyên tử. Không có trigger thực hiện nghiệp vụ.

## 5. Nâng cấp an toàn

1. Kiểm tra `git status`, branch, đúng file `.env`/biến môi trường shell. Đọc `SELECT current_database(), current_user, inet_server_addr(), inet_server_port()` và `_prisma_migrations`; không suy ra database nguồn chỉ từ compose.
2. Dừng luồng ghi khi lấy snapshot đối chiếu. Dùng `pg_dump -Fc` nhất quán; đọc `pg_restore --list`, restore vào **database mới riêng biệt** với `--exit-on-error`, so sánh dữ liệu trước khi thử migration.
3. Chạy validate/generate và toàn bộ migration trên database mới. Chạy kiểm thử với ba URL riêng biệt: DATABASE_URL là nguồn chỉ đọc, TEST_DATABASE_URL là DB test, PAYMENT_UPGRADE_DATABASE_URL là bản restore chưa nâng cấp, có dữ liệu giống nguồn. Không đặt schema override trong URL test/copy.
4. Chạy hai migration mới theo thứ tự. Migration enum được tách riêng để PostgreSQL commit enum label trước khi CHECK sử dụng. Migration nền tảng có BEGIN/COMMIT để rollback nguyên tử nếu dữ liệu không đạt CHECK/FK/unique.
5. Đối chiếu mọi cột/dòng cũ, số dư, reversedAt, các bảng catalog/kho/công thức, lịch sử migration; chạy `migrate diff`, rồi `migrate deploy` lại để xác nhận no-op.
6. Chỉ sau khi bạn 2 đã nối code tương thích và thử nghiệm ứng dụng, mới lên lịch nâng cấp nguồn. Trong lần bàn giao này nguồn vẫn chưa migrate; không chạy ứng dụng với client mới trên schema nguồn cũ.

Lệnh từ thư mục `backend` (URL phải được thiết lập trong môi trường, không commit credential):

```powershell
npx.cmd prisma validate
npx.cmd prisma generate
# DATABASE_URL=nguồn; TEST_DATABASE_URL=DB test; PAYMENT_UPGRADE_DATABASE_URL=bản restore mới
npm.cmd run test:database:payment
npm.cmd run test:database
# Trong shell khác, DATABASE_URL trỏ tới bản sao đã xác minh:
npx.cmd prisma migrate status
npx.cmd prisma migrate deploy
npx.cmd prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Bộ kiểm thử payment đòi ba tên database khác nhau kể cả khi dùng hostname alias, từ chối thiếu biến và không bỏ qua test. Mỗi lần chạy cần bản restore mới giống nguồn; các schema test dùng UUID riêng. Test không drop database, không reset và không sửa migration-history đã có.

Migration sẽ **dừng** khi có dữ liệu chưa phù hợp: thanh toán không bằng tổng đơn, điểm sai dấu/phương thức, user/payment liên kết sai đơn, providerRef trùng cùng phương thức, nhiều yêu cầu hoàn cho một payment, hoàn từng phần hoặc trạng thái hoàn thiếu bằng chứng thời gian. Phải điều tra từng trường hợp từ backup và chứng từ thật; không tự chỉnh số dư, xóa giao dịch hoặc bỏ CHECK để vượt lỗi. Chưa kiểm chứng các dạng lịch sử lệch khác ngoài nguồn nêu ở mục 1.

Không dùng `migrate reset`, `--force-reset`, `--accept-data-loss`, `db push`, xóa DB/volume hoặc resolve-applied để giả lập cấu trúc chưa tồn tại. Nếu DB chưa đầy đủ lịch sử, việc `migrate deploy` chạy thành công không tự chứng minh lịch sử đã được phục hồi.

## 6. Kết quả kiểm thử thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Prisma validate / generate | PASS, Prisma CLI/Client 6.19.3 |
| Toàn bộ 7 migration trên schema trắng trong DB test mới | PASS |
| Nâng cấp baseline 5 migration có fixture cũ (WALLET/CARD, 0 điểm, reversedAt, đã hoàn mock) | PASS, nguyên dữ liệu cũ, không sinh mã VNPAY |
| Restore backup thật và nâng cấp | PASS; mọi cột/dòng cũ của cả 17 bảng nghiệp vụ giữ nguyên; 7 dòng history cũ không đổi |
| Bộ SQL payment | **12/12 PASS**, khoảng 31.6 giây; có CHECK, FK, unique, idempotency, thu đến muộn, log và hoàn toàn bộ |
| Bộ SQL catalog/kho/topping hiện có | **9/9 PASS**, khoảng 40.6 giây; fixture được đổi sang SQL đúng schema cũ, không đổi nghiệp vụ |
| `migrate diff` bản sao → schema và schema trắng đã migrate → schema | PASS: `No difference detected`, exit 0; URL datasource/schema đích được đặt khớp namespace đang kiểm tra. CHECK/partial index được kiểm tra riêng bằng SQL test |
| `migrate deploy` lần hai | PASS, `No pending migrations`, dữ liệu/history không đổi trên cả schema trắng, fixture cũ, bản sao thật |
| Nguồn sau kiểm thử | Snapshot mọi dòng bằng trước; vẫn 7 migration đã có, chưa có 2 migration mới |
| TypeScript toàn dự án (`tsc --noEmit --incremental false`) | **Chưa pass**: các điểm bàn giao ở mục 7; không sửa code nghiệp vụ |

Nguồn và bản sao sau nâng cấp đều giữ: 10 Product, 3 Topping, 13 liên kết Product–Topping, 14 Ingredient, 30 ProductRecipe, 132 ProductRecipeIngredient, 14 InventoryMovement; 2 User, 3 Order, 3 OrderItem, 3 Payment, 1 LoyaltyTransaction, 3 PromoCode; không có reservation/refund/log trước nâng cấp. Đối chiếu dùng toàn bộ giá trị cột cũ, không chỉ đếm dòng.

## 7. Bàn giao cho bạn 2

**Client mới chưa tương thích hoàn toàn với code nghiệp vụ hiện tại. Không đưa bản schema/client này lên chạy ứng dụng trước khi hoàn tất các chỗ sau.**

| File / vị trí hiện tại | Việc cần thực hiện |
| --- | --- |
| `backend/src/payments/payments.service.ts:238–240` | Khi tạo LoyaltyTransaction, cung cấp eventKey ổn định, type và paymentId. Hiện tsc báo thiếu eventKey. Ghi biến động và số dư trong một transaction có khóa/điều kiện đủ điểm; xử lý replay theo idempotencyKey/requestHash |
| `backend/src/orders/orders.service.ts:377,455–457` | Đổi include `loyaltyTransaction` sang `loyaltyTransactions`; tìm EARN đúng loại. Không còn một dòng duy nhất cho đơn. Hiện tsc báo truy cập id trên never; cập nhật cả cách thu hồi và tránh thu hồi lại EARN có reversedAt |
| `backend/src/orders/orders.service.ts:470–478` | Thay hoàn mock ngay lúc hủy bằng tạo/cập nhật PaymentRefund; chỉ ghi refundedAt/refundedAmount/refundRef sau xác nhận. Hủy đơn và xác nhận hoàn là hai việc riêng |
| `backend/test/security-concurrency.e2e-spec.ts:485` | `findUniqueOrThrow({where:{orderId}})` không còn hợp lệ; tìm EARN theo orderId/type hoặc dùng khóa ổn định. Các assertion count cần xét loại biến động |
| `backend/src/payments/dto/process-payment.dto.ts` và `mock-payment.service.ts` | DTO/service hiện còn WALLET/CARD; bạn 2 nối VNPAY/POINTS và giữ đường cũ theo yêu cầu sản phẩm. Không tự đưa method mới vào mock rồi coi là thanh toán thật |
| `backend/src/payments/*`, các handler mới | Tạo link với đầy đủ ref/ngày/hạn, xác minh IPN/Return, query đối soát, giữ ref gốc khi hết hạn; xử lý NEEDS_REFUND khi đến muộn. Log đã lọc, chống xử lý lặp bằng transaction/khóa Payment + Order |
| `backend/test/inventory.e2e-spec.ts:797` | Tsc còn báo `status(preOrderId, 'PREPARING')` truyền 2 tham số trong khi helper nhận 1. Không nằm trong diff nghiệp vụ lần này; cần sửa riêng trước khi coi toàn bộ build/e2e xanh |

Bạn 2 cần thêm kiểm thử nghiệp vụ/e2e cho đủ/thiếu điểm, trừ đồng thời, IPN lặp/đến muộn, Return trước IPN, query khôi phục, hủy đang xử lý, hoàn thất bại/thử lại và điểm đã dùng trước khi thu hồi thưởng. Bộ kiểm thử lần này xác nhận database, chưa xác nhận các handler hay thao tác ngân hàng thật.

## 8. File thay đổi

- `backend/prisma/schema.prisma`.
- Hai migration mới: `20261105090000_payment_enums`, `20261105091000_payment_foundation`.
- `backend/prisma/payment-database.test.ts`, script `test:database:payment` trong `backend/package.json`.
- `backend/prisma/ingredient-database.test.ts`: cập nhật fixture/projection cho schema lịch sử, giữ kiểm chứng bảo toàn dữ liệu.
- `backend/src/generated/prisma/**`: kết quả generate từ schema, gồm PaymentRefund/PaymentWebhookLog và các kiểu quan hệ mới. Không sửa tay.
- `.gitignore`: bỏ qua backup riêng tư.
- `docs/payment-database.md`: tài liệu này.

Không đổi seed, nghiệp vụ sản phẩm/topping/nguyên liệu/công thức/kho, backend thanh toán hoặc frontend; không commit/push thay người dùng.
