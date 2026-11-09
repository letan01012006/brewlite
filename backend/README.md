<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Product và topping

`ProductsModule` quản lý cả sản phẩm và danh mục topping. `Product.toppings` và
`Topping.products` là quan hệ nhiều–nhiều qua bảng `_ProductToTopping`; topping
không phải sản phẩm bán độc lập. `PricingService` vẫn ở `common/pricing` và dùng
chung cho orders và promotions, không phụ thuộc ProductsModule.

### Nâng cấp an toàn

Prisma dùng `engineType = "client"` với adapter PostgreSQL hiện có, không nạp DLL
query engine vào backend. Nest không sao chép native DLL vào `dist`.
Trong `backend`, dùng cấu hình `DATABASE_URL` hiện tại:

```powershell
npx.cmd prisma validate
npx.cmd prisma migrate status
# Chỉ tiếp tục nếu lịch sử migration không lỗi/lệch; pending là bình thường.
npx.cmd prisma migrate deploy
npx.cmd prisma generate
# Tùy chọn: bổ sung dữ liệu mẫu nếu cần.
npx.cmd prisma db seed
npx.cmd prisma migrate status
npm.cmd run start:dev
```

Không sửa migration đã áp dụng. Nếu có migration failed, checksum/lịch sử lệch
hoặc công cụ yêu cầu reset, dừng và đối chiếu database/lịch sử trước. Không dùng
`migrate reset`, `--force-reset`, xóa database hay volume để nâng cấp.

Migration mới `20261103153000_product_toppings` chỉ thêm bảng liên kết và backfill
mẫu **một lần**, được đánh dấu bằng lịch sử migration của Prisma. Nó bổ sung các
topping mẫu còn thiếu (Trân châu 5.000₫, Kem cheese 7.000₫, Thạch 4.000₫) bằng
`ON CONFLICT DO NOTHING`, tra ID thực theo tên rồi liên kết món đã có. Không sửa
ID/giá/tồn kho/version/isActive của bản ghi cũ, tài khoản, điểm hay lịch sử đơn.

| Món mẫu | Topping ban đầu |
| --- | --- |
| Cà phê sữa, Bạc xỉu, Cà phê muối | Kem cheese, Thạch |
| Americano, Cappuccino, Latte | Không có |
| Trà đào, Trà vải | Thạch |
| Trà sữa trân châu | Trân châu, Kem cheese, Thạch |
| Matcha đá xay | Trân châu, Kem cheese |

Database mới cũng áp dụng migration trước khi seed. Seed upsert topping theo tên,
lấy ID trả về rồi tạo sản phẩm mới cùng liên kết trong transaction. Với sản phẩm
cũ, việc backfill đã do migration xử lý; seed không đặt lại liên kết. Chạy seed
nhiều lần không tạo trùng tên và không ghi đè lựa chọn quản lý đã sửa, kể cả khi
đã gỡ hết topping. Mapping nằm trong `prisma/demo-product-toppings.ts` chỉ phục vụ
demo; runtime luôn đọc quan hệ database, không suy diễn từ tên/category.

### API và luồng đặt món

| Endpoint (prefix `/api`) | Quyền | Dữ liệu |
| --- | --- | --- |
| `GET /products` | Public | Giữ `{ data, meta }`, tìm kiếm/lọc/phân trang; mỗi món có topping liên kết đang active |
| `GET /products/:id` | Public | Mô tả, stock/inStock, `sizes: [{ size, surcharge }]`, `toppings: [{ id, name, price }]` |
| `GET /products/toppings` | Public | Toàn bộ danh mục topping active, phục vụ cấu hình món |
| `POST /products/toppings` | BARISTA | `{ name, price }`, tên được trim, giá nguyên không âm; trùng tên trả 409 `TOPPING_ALREADY_EXISTS` |
| `POST /products` | BARISTA | Nhận thêm `toppingIds` tùy chọn; bỏ qua tương đương `[]` |
| `PATCH /products/:id/toppings` | BARISTA | `{ toppingIds: [...] }` thay thế chính xác; `[]` gỡ hết |
| `GET/POST /toppings` | Như endpoint mới tương ứng | Alias tương thích, cùng ToppingsService |

Các API public không trả `version` hoặc `isActive`. Route tĩnh topping được đăng
ký trước `products/:id`. ID trùng, sai kiểu/ngoài miền Int, không tồn tại hoặc
topping inactive bị từ chối, không tạo/cập nhật dở dang. Số topping **được cấu
hình** không giới hạn ở 3; chỉ khách chọn topping trên **một ly** mới tối đa 3.

Luồng: chọn món → `GET /products/:id` → modal dùng sizes/toppings của món → gửi
productId/size/toppingIds/quantity → PricingService kiểm tra quan hệ và active →
tính `unitPrice = product.price + size surcharge + tổng topping` →
`lineTotal = unitPrice × quantity`. Orders gọi cùng service bên trong transaction
hiện có trước khi giữ tồn kho/áp khuyến mãi. Promotions dùng cùng quy tắc.

OrderItem vẫn lưu snapshot JSON `{ id, name, price }`. Đổi giá/tên topping hoặc
gỡ liên kết không sửa đơn cũ; thanh toán dùng total đã chốt. Khóa, kiểm tra
version, retry tồn kho, hủy/hoàn kho và idempotency thanh toán giữ nguyên.

Frontend không tải danh mục topping toàn cục để đặt món. Bấm trực tiếp và
`openProduct` sau đăng nhập dùng chung request chi tiết, có loading/lỗi và
abort/request ID. Refresh giỏ bỏ topping không còn được phép/inactive, cập nhật
giá và khuyến mãi, giữ phần còn hợp lệ. Nếu thành phần đổi, khách phải xem lại và
bấm xác nhận thêm lần nữa trước khi tạo đơn, kể cả tổng tiền không đổi. Cờ cần
xác nhận được lưu cùng giỏ cũ, không xóa phiên đăng nhập hay checkout đã giữ đơn.

### Ví dụ đã chạy trên database kiểm thử riêng

ID dưới đây lấy từ kết quả HTTP thực sau migrate/seed trong database kiểm thử;
không dùng chúng làm hằng số trong code hoặc giả định giống database của bạn.

`GET /api/products/1` trả 200, trích các trường liên quan:

```json
{
  "id": 1,
  "name": "Cà phê sữa",
  "price": 35000,
  "toppings": [
    { "id": 2, "name": "Kem cheese", "price": 7000 },
    { "id": 3, "name": "Thạch", "price": 4000 }
  ],
  "sizes": [
    { "size": "S", "surcharge": 0 },
    { "size": "M", "surcharge": 5000 },
    { "size": "L", "surcharge": 10000 }
  ]
}
```

`POST /api/orders` với Bearer token CUSTOMER:

```json
{ "items": [{ "productId": 1, "size": "M", "quantity": 2, "toppingIds": [2] }] }
```

Trả 201 với subtotal/total 94.000₫; dòng món có unitPrice 47.000₫, qty 2,
lineTotal 94.000₫ và snapshot topping `{ "id": 2, "name": "Kem cheese", "price": 7000 }`.
Đơn ví dụ được hủy trên database kiểm thử để hoàn tồn kho.

Kiểm thử PostgreSQL/guards/concurrency và cách đặt `TEST_DATABASE_URL` xem
[test/README.md](test/README.md). Test frontend là kiểm tra handler mô phỏng,
không thay thế việc thử bàn phím/focus và thao tác trên trình duyệt thật.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
