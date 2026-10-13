'use client';

import React from 'react';
import type { Product } from '@/types';
import { getProductImageUrl } from '@/lib/constants/product-images';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

export function ProductCard({ product, onSelect }: ProductCardProps) {
  const [imgError, setImgError] = React.useState(false);
  const isOutOfStock = product.stock <= 0;
  const imageSrc = getProductImageUrl(product.name, product.category, product.imageUrl);

  return (
    <div className="group bg-white dark:bg-[#181412] rounded-2xl sm:rounded-3xl border border-stone-200/80 dark:border-[#2a221c] p-3 sm:p-4 shadow-sm hover:shadow-md dark:shadow-none dark:hover:border-amber-500/40 transition-all duration-200 flex flex-col justify-between">
      <div>
        {/* Ảnh đồ uống hoặc Placeholder */}
        <div className="relative w-full h-32 sm:h-40 rounded-xl sm:rounded-2xl overflow-hidden bg-gradient-to-br from-[#f5ede4] to-[#fbf8f5] dark:from-[#241c17] dark:to-[#17120f] flex items-center justify-center mb-2.5 border border-amber-950/5 dark:border-stone-800">
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              loading="lazy"
              decoding="async"
              src={imageSrc}
              srcSet={imageSrc.startsWith('https://images.unsplash.com/') ? [240, 400, 600].map((width) => {
                const url = new URL(imageSrc);
                url.searchParams.set('w', String(width));
                return `${url} ${width}w`;
              }).join(', ') : undefined}
              sizes="(min-width: 1024px) 280px, (min-width: 768px) 30vw, 45vw"
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-amber-800/60 dark:text-amber-400/60 group-hover:scale-105 transition-transform duration-300">
              <span className="text-4xl drop-shadow-sm">☕</span>
              <span className="text-[10px] font-bold text-amber-800/60 dark:text-amber-400/60 mt-1 uppercase tracking-wider">
                BrewLite
              </span>
            </div>
          )}

          {/* Badge danh mục */}
          <span className="absolute top-2 left-2 bg-[#1f1612]/80 dark:bg-black/70 backdrop-blur-md text-amber-200 border border-amber-500/20 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md">
            {product.category}
          </span>

          {/* Badge tồn kho */}
          {isOutOfStock ? (
            <span className="absolute top-2 right-2 bg-rose-600/90 backdrop-blur-sm text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shadow-sm">
              Hết
            </span>
          ) : product.stock <= 5 ? (
            <span className="absolute top-2 right-2 bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shadow-sm">
              Còn {product.stock}
            </span>
          ) : null}
        </div>

        {/* Tên & mô tả */}
        <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors line-clamp-1">
          {product.name}
        </h3>
        <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 line-clamp-1 leading-snug">
          {product.description || 'Pha chế tươi mới theo công thức chuẩn.'}
        </p>
      </div>

      {/* Giá tiền & Nút chọn */}
      <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-850 flex items-center justify-between gap-1">
        <div>
          <span className="text-[9px] text-stone-400 uppercase tracking-wider font-semibold block leading-none">
            Giá từ
          </span>
          <span className="text-xs sm:text-sm font-black text-amber-950 dark:text-amber-400 font-mono mt-0.5 block">
            {product.price.toLocaleString('vi-VN')}₫
          </span>
        </div>

        <button
          onClick={() => onSelect(product)}
          disabled={isOutOfStock}
          aria-label={`Đặt món ${product.name}`}
          className="bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:from-stone-300 disabled:to-stone-300 dark:disabled:from-stone-800 dark:disabled:to-stone-800 text-white text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer disabled:cursor-not-allowed shrink-0"
        >
          {isOutOfStock ? 'Hết hàng' : '+ Đặt'}
        </button>
      </div>
    </div>
  );
}
