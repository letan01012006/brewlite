'use client';

import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  Suspense,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Product, Topping } from '@/types';
import { apiFetch, ApiError } from '@/lib/api/client';
import { ProductCard } from '@/components/products/product-card';
import { ProductModal } from '@/components/products/product-modal';
import { useCartStore } from '@/store/cart-store';
import { useAuthStore } from '@/store/auth-store';
import { allProducts } from '@/lib/api/pagination';
import { Pagination } from '@/components/ui/pagination';

function MenuContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openProductId = searchParams.get('openProduct');

  const user = useAuthStore((state) => state.user);

  const [products, setProducts] = useState<Product[]>([]);
  const [toppings, setToppings] = useState<Topping[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tất cả');
  const [page, setPage] = useState(1);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const totalItemCount = useCartStore((state) => state.getTotalItemCount());
  const subtotal = useCartStore((state) => state.getSubtotal());

  // Tải danh sách món và toppings từ Backend API
  const fetchData = useCallback(async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setIsLoading(true);
    setError(null);
    try {
      const [productsRes, toppingsRes] = await Promise.all([
        allProducts<Product>(request.signal),
        apiFetch<Topping[]>('/toppings', {
          signal: request.signal,
          auth: false,
        }),
      ]);

      if (id !== requestId.current) return;
      setProducts(productsRes);
      setPage(1);
      setToppings(toppingsRes || []);
    } catch (err) {
      if (request.signal.aborted || id !== requestId.current) return;
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        const errorDetail = err instanceof Error ? err.message : String(err);
        setError(`Không thể kết nối đến backend (${errorDetail}).`);
      }
    } finally {
      if (id === requestId.current && !request.signal.aborted)
        setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void fetchData(), 0);
    return () => {
      clearTimeout(initial);
      controller.current?.abort();
    };
  }, [fetchData]);

  // Tự động mở modal cho món vừa chọn sau khi đăng nhập thành công
  useEffect(() => {
    if (openProductId && products.length > 0 && user) {
      const target = products.find((p) => p.id === Number(openProductId));
      if (target) {
        setSelectedProduct(target);
      }
    }
  }, [openProductId, products, user]);

  // Chặn đăng nhập khi bấm Đặt món và lưu lại redirect kèm ID món vừa chọn
  const handleSelectProduct = (product: Product) => {
    if (!user) {
      const targetUrl = `/menu?openProduct=${product.id}`;
      router.push(`/login?redirect=${encodeURIComponent(targetUrl)}`);
      return;
    }
    setSelectedProduct(product);
  };

  // Danh sách danh mục độc nhất
  const categories = useMemo(() => {
    const cats = Array.from(
      new Set(products.map((p) => p.category).filter(Boolean)),
    );
    return ['Tất cả', ...cats];
  }, [products]);

  // Lọc sản phẩm theo Category và Tìm kiếm
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchCat =
        selectedCategory === 'Tất cả' || product.category === selectedCategory;
      const matchSearch =
        searchQuery.trim() === '' ||
        product.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchCat && matchSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  return (
    <div className="min-h-screen pb-24 dark:bg-stone-950 transition-colors">
      {/* Banner đầu trang Menu */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#18120e] via-[#221812] to-[#140e0b] text-white pt-10 pb-16 px-4 border-b border-[#2e2019]/60 dark:border-stone-850">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[250px] bg-amber-500/10 blur-[100px] pointer-events-none rounded-full" />
        <div className="relative max-w-5xl mx-auto text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-amber-400 font-semibold uppercase tracking-widest">
            <Link href="/" className="hover:underline">Trang chủ</Link>
            <span>/</span>
            <span>Thực đơn</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white">
            Thực Đơn Đồ Uống BrewLite
          </h1>
          <p className="text-xs sm:text-sm text-stone-300 max-w-lg mx-auto font-light leading-relaxed">
            Khám phá hương vị cà phê và trà được pha chế tươi mới. Đặt online, nhận đồ uống liền tay không phải chờ đợi.
          </p>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="max-w-6xl mx-auto px-4 -mt-8">
        {/* Thanh tìm kiếm & lọc danh mục */}
        <div className="bg-white dark:bg-[#181412] rounded-3xl p-4 sm:p-5 shadow-[0_4px_25px_rgba(40,25,15,0.06)] dark:shadow-none border border-stone-200/80 dark:border-[#2a221c] space-y-3.5 transition-colors">
          {/* Ô tìm kiếm */}
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-stone-400">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm kiếm đồ uống theo tên (Cà phê sữa, Latte, Trà đào...)..."
              className="w-full pl-11 pr-4 py-3 bg-[#f8f4ef] dark:bg-[#201a16] rounded-2xl border border-stone-200/80 dark:border-[#332820] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/10 text-sm text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setPage(1);
                }}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-stone-400 hover:text-stone-600 text-xs cursor-pointer"
              >
                Xóa
              </button>
            )}
          </div>

          {/* Bộ lọc Danh mục */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setPage(1);
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-md shadow-amber-900/20'
                      : 'bg-stone-100/90 dark:bg-[#221b17] hover:bg-stone-200/90 dark:hover:bg-[#2d241f] text-stone-700 dark:text-stone-300'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tiêu đề danh sách món */}
        <div className="mt-8 mb-5 flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-black text-stone-900 dark:text-stone-100 tracking-tight">
            {selectedCategory === 'Tất cả'
              ? 'Toàn bộ Menu'
              : `Món ${selectedCategory}`}
          </h2>
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/50 px-2.5 py-1 rounded-full border border-amber-300/40 dark:border-amber-800/40">
            {filteredProducts.length} món
          </span>
        </div>

        {/* Trạng thái Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <div
                key={n}
                className="bg-white dark:bg-[#181412] rounded-3xl border border-stone-200/80 dark:border-[#2a221c] p-4 animate-pulse space-y-3"
              >
                <div className="w-full h-44 bg-stone-200 dark:bg-stone-800 rounded-2xl" />
                <div className="h-4 bg-stone-200 dark:bg-stone-800 rounded w-3/4" />
                <div className="h-3 bg-stone-200 dark:bg-stone-800 rounded w-1/2" />
                <div className="h-8 bg-stone-200 dark:bg-stone-800 rounded-xl mt-4" />
              </div>
            ))}
          </div>
        )}

        {/* Trạng thái Lỗi */}
        {!isLoading && error && (
          <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-3xl p-8 text-center space-y-3 my-8">
            <span className="text-4xl block">⚠️</span>
            <h3 className="font-bold text-rose-800 dark:text-rose-200 text-base">{error}</h3>
            <p className="text-xs text-rose-600 dark:text-rose-400">
              Hãy chắc chắn rằng backend đang chạy tại cổng 4000 (npm run start:dev).
            </p>
            <button
              onClick={fetchData}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
            >
              Thử lại ngay
            </button>
          </div>
        )}

        {/* Không tìm thấy kết quả */}
        {!isLoading && !error && filteredProducts.length === 0 && (
          <div className="bg-white dark:bg-[#181412] border border-stone-200/80 dark:border-[#2a221c] rounded-3xl p-12 text-center space-y-2 my-8">
            <span className="text-4xl block">🔍</span>
            <h3 className="font-bold text-stone-800 dark:text-stone-200 text-base">
              Không tìm thấy món nào
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Thử tìm kiếm với từ khóa khác hoặc chuyển sang danh mục khác.
            </p>
          </div>
        )}

        {/* Lưới sản phẩm */}
        {!isLoading && !error && filteredProducts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {filteredProducts
              .slice((page - 1) * 12, page * 12)
              .map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onSelect={handleSelectProduct}
                />
              ))}
          </div>
        )}
      </div>

      {!isLoading && !error && (
        <Pagination
          page={page}
          totalPages={Math.ceil(filteredProducts.length / 12)}
          onChange={setPage}
        />
      )}

      {/* Modal Tùy chỉnh Size & Topping khi chọn món */}
      <ProductModal
        product={selectedProduct}
        toppings={toppings}
        isOpen={selectedProduct !== null}
        onClose={() => setSelectedProduct(null)}
      />

      {/* Floating Cart Bar */}
      {totalItemCount > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-40 max-w-xl mx-auto px-4 animate-slideUp">
          <Link
            href="/cart"
            className="bg-[#1a1411]/95 dark:bg-[#120f0d]/95 backdrop-blur-md text-white p-3.5 sm:p-4 rounded-2xl shadow-2xl flex items-center justify-between border border-amber-900/40 dark:border-[#2a221c] hover:bg-[#221a16] transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center font-black text-sm text-white shadow-sm shadow-amber-900/30">
                {totalItemCount}
              </div>
              <div>
                <div className="text-xs text-amber-300/90 font-medium">Giỏ hàng của bạn</div>
                <div className="text-sm sm:text-base font-extrabold font-mono">
                  {subtotal.toLocaleString('vi-VN')}₫
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold bg-gradient-to-r from-amber-500 to-amber-600 group-hover:from-amber-400 group-hover:to-amber-500 text-stone-950 px-4 py-2.5 rounded-xl shadow-md shadow-amber-500/20 transition-all">
              <span>Xem giỏ hàng</span>
              <span>→</span>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}

export default function MenuPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-xs text-stone-400">
          Đang tải thực đơn...
        </div>
      }
    >
      <MenuContent />
    </Suspense>
  );
}
