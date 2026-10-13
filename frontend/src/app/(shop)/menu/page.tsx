'use client';

import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  Suspense,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Product, Topping } from '@/types';
import { apiFetch, ApiError } from '@/lib/api/client';
import { ProductCard } from '@/components/products/product-card';
import { ProductModal } from '@/components/products/product-modal';
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
  const userId = user?.id;
  const consumedProduct = useRef<string | null>(null);

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
    if (!openProductId) {
      consumedProduct.current = null;
      return;
    }
    const intent = `${userId}:${openProductId}`;
    if (products.length > 0 && userId && consumedProduct.current !== intent) {
      const target = products.find((p) => p.id === Number(openProductId));
      if (target) {
        const timer = setTimeout(() => {
          consumedProduct.current = intent;
          setSelectedProduct(target);
          const params = new URLSearchParams(searchParams.toString());
          params.delete('openProduct');
          router.replace(`/menu${params.size ? `?${params}` : ''}`, { scroll: false });
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [openProductId, products, userId, router, searchParams]);

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
    <div className="pb-12 dark:bg-stone-950 transition-colors">
      {/* Compact Mobile Header */}
      <section className="pt-2 pb-3">
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-stone-900 dark:text-stone-100 flex items-center justify-between">
          <span>Thực Đơn Đồ Uống</span>
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-300/40">
            {filteredProducts.length} món
          </span>
        </h1>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
          Pha chế tươi mới • Đặt online nhận ngay
        </p>
      </section>

      {/* Sticky Search & Category Pills */}
      <div className="sticky top-[var(--app-header-height)] z-20 bg-stone-50/95 dark:bg-stone-950/95 backdrop-blur-md pt-1 pb-3 space-y-2.5 transition-colors">
        {/* Ô tìm kiếm */}
        <div className="relative">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm món (Cà phê sữa, Latte, Trà đào...)..."
            className="w-full pl-9 pr-8 py-2.5 bg-white dark:bg-[#1a1411] rounded-2xl border border-stone-200 dark:border-[#2e241e] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 text-xs sm:text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 shadow-sm transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setPage(1);
              }}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Bộ lọc Danh mục cuộn ngang */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 cursor-pointer ${
                  isActive
                    ? 'bg-amber-600 text-white shadow-sm shadow-amber-900/30'
                    : 'bg-white dark:bg-[#1a1411] hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200/80 dark:border-[#2e241e]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div>
        {/* Trạng thái Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6 mt-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <div
                key={n}
                className="bg-white dark:bg-[#181412] rounded-3xl border border-stone-200/80 dark:border-[#2a221c] p-3 animate-pulse space-y-2.5"
              >
                <div className="w-full h-32 sm:h-36 bg-stone-200 dark:bg-stone-800 rounded-2xl" />
                <div className="h-4 bg-stone-200 dark:bg-stone-800 rounded w-3/4" />
                <div className="h-3 bg-stone-200 dark:bg-stone-800 rounded w-1/2" />
                <div className="h-8 bg-stone-200 dark:bg-stone-800 rounded-xl mt-2" />
              </div>
            ))}
          </div>
        )}

        {/* Trạng thái Lỗi */}
        {!isLoading && error && (
          <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-3xl p-6 text-center space-y-2.5 my-6">
            <span className="text-3xl block">⚠️</span>
            <h3 className="font-bold text-rose-800 dark:text-rose-200 text-sm">{error}</h3>
            <p className="text-xs text-rose-600 dark:text-rose-400">
              Hãy chắc chắn rằng backend đang chạy tại cổng 4000.
            </p>
            <button
              onClick={fetchData}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm cursor-pointer"
            >
              Thử lại ngay
            </button>
          </div>
        )}

        {/* Không tìm thấy kết quả */}
        {!isLoading && !error && filteredProducts.length === 0 && (
          <div className="bg-white dark:bg-[#181412] border border-stone-200/80 dark:border-[#2a221c] rounded-3xl p-8 text-center space-y-2 my-6">
            <span className="text-3xl block">🔍</span>
            <h3 className="font-bold text-stone-800 dark:text-stone-200 text-sm">
              Không tìm thấy món nào
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Thử tìm kiếm với từ khóa khác hoặc chọn danh mục khác.
            </p>
          </div>
        )}

        {/* Lưới sản phẩm Responsive: 2 cột mobile, 3 cột tablet, 4 cột desktop */}
        {!isLoading && !error && filteredProducts.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6 mt-4">
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
