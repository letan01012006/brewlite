# Ghi nhận sửa frontend BrewLite

Ngày: 03/11/2026. Làm trên nhánh local `feat/web-only`.

## Các mục đã sửa

1. **Redirect đăng nhập/đăng ký**
   - Tạo `src/lib/safe-redirect.ts`: chỉ nhận đường dẫn bắt đầu bằng `/`,
     không bắt đầu `//`, không chứa backslash hoặc ký tự điều khiển C0/C1/DEL.
     Giá trị không hợp lệ trả về `/`.
   - `src/app/(auth)/login/page.tsx` và `register/page.tsx` dùng kết quả đã kiểm
     tra cho router.push và link chéo đã encode. Giữ chuyển hướng barista khi login.
   - Thêm `test/safe-redirect.test.mjs`: 13 test, gồm các case được yêu cầu,
     đường dẫn gốc và ký tự điều khiển.

2. **Code và câu chữ thừa**
   - Tìm tham chiếu trong frontend trước khi xóa
     `src/components/navbar/navbar.tsx`; không có nơi import/sử dụng component.
   - Sửa comment global navbar thành website header ở
     `src/app/(shop)/checkout/page.tsx`.
   - Sửa comment heading/lưới sản phẩm ở `src/app/(shop)/menu/page.tsx`;
     đổi câu trên điện thoại/máy tính thành trên website ở `src/app/(shop)/page.tsx`.

3. **Class Tailwind**
   - Thay `dark:border-stone-850` bằng `dark:border-stone-800` trong
     `src/components/products/product-card.tsx`, `src/components/layout/app-header.tsx`
     và `src/app/(shop)/page.tsx`.
   - Bỏ `scrollbar-none` ở menu, định nghĩa `.no-scrollbar` cho Firefox/WebKit
     trong `src/app/globals.css`. Rà lại src không còn các class/câu chữ cũ trên.

4. **Giao diện desktop**
   - Header hiện lời chào/điểm từ md; tên dài có thể thu gọn để giữ chỗ cho thao tác.
     Nút đăng xuất hỏi `window.confirm("Bạn có chắc muốn đăng xuất?")` trước logout.
   - `src/app/(shop)/cart/page.tsx` dùng `w-full`, bỏ max-w-6xl/mx-auto/px-4 ở
     wrapper chính để nhận bề rộng/padding từ shop layout.
   - Wrapper chính checkout thực tế đã là `w-full py-2 sm:py-4`, không có px-4
     hoặc giới hạn bề rộng, nên không cần sửa. Giữ trạng thái thành công/giỏ trống
     đang căn giữa và padding riêng của các trạng thái đó.
   - Tên/giá product card tăng lên md:text-base, nút lên md:text-sm, không đổi lưới.

5. **Modal dùng chung**
   - `src/components/ui/modal.tsx` tự render backdrop native, căn giữa và xử lý
     click ngoài. Chỉ bật flex khi dialog open để không hiện trước showModal.
   - Bỏ overlay và div click-outside riêng trong
     `src/components/products/product-modal.tsx` và `src/app/(shop)/orders/page.tsx`.
   - Giữ max-h-[90dvh], vùng body overflow-y-auto, showModal, xử lý Escape,
     khóa scroll và khôi phục focus. Không đóng khi kéo chuột từ nội dung ra ngoài.
   - Thêm `test/modal.test.mjs`: 3 test lifecycle native dialog/scroll/focus,
     click ngoài so với click trong/drag, Escape và trigger đã bị tháo khỏi DOM.

6. **AuthGate barista**
   - `src/app/barista/page.tsx` bỏ useRouter, initAuth/redirect effect và điều kiện
     token/role/loading trùng lặp của BaristaContent. AuthGate barista tiếp tục
     đảm nhiệm quyền truy cập/chuyển hướng. Giữ request, polling, abort và action.

## Kiểm tra thực tế

Chạy trong frontend:

| Lệnh | Kết quả |
| --- | --- |
| npm.cmd run lint | PASS, exit 0, không warning/lỗi lint |
| npx.cmd tsc --noEmit --incremental false | PASS, exit 0 |
| npm.cmd test | PASS 72/72, không skip: 56 test cũ + 13 redirect + 3 modal |
| npm.cmd run build | PASS, exit 0; biên dịch, TypeScript và prerender hoàn tất |

Không bỏ mục sửa nào. Checkout không cần thay wrapper vì code local đã đúng.
Chưa kiểm tra trực quan hoặc tương tác trong browser thật: công cụ trình duyệt
trả về “The browser access host is unavailable”. Test modal mô phỏng event và
lifecycle, không chứng minh hành vi focus trap/scroll thực tế của trình duyệt.
Không chạy giao dịch với backend thật.

Không sửa backend, public/sw.js, legacy-pwa-cleanup, store auth/cart hoặc logic
thanh toán; không đổi thư viện/cấu hình môi trường.

## Git theo thay đổi yêu cầu

Trước khi người dùng yêu cầu ngừng Git, đã tạo 2 commit local theo chỉ dẫn trước:
`217ba47` (mục 1) và `0c9faba` (mục 2). Không push.
Lệnh stage mục 3 bị người dùng từ chối. Sau yêu cầu “đừng có git gì hết”,
không chạy thêm lệnh Git; các thay đổi còn lại được giữ trong workspace.
