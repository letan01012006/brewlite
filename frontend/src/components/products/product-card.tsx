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
    <div className="group bg-white dark:bg-[#181412] rounded-3xl border border-stone-200/80 dark:border-[#2a221c] p-4 shadow-[0_2px_12px_rgba(40,25,15,0.04)] hover:shadow-[0_12px_32px_rgba(180,83,9,0.14)] dark:shadow-none dark:hover:border-amber-500/40 transition-all duration-300 flex flex-col justify-between">
      <div>
        {/* Ảnh đồ uống hoặc Placeholder */}
        <div className="relative w-full h-44 rounded-2xl overflow-hidden bg-gradient-to-br from-[#f5ede4] to-[#fbf8f5] dark:from-[#241c17] dark:to-[#17120f] flex items-center justify-center mb-3.5 border border-amber-950/5 dark:border-stone-800">
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-amber-800/60 dark:text-amber-400/60 group-hover:scale-110 transition-transform duration-300">
              <span className="text-5xl drop-shadow-sm">☕</span>
              <span className="text-[11px] font-bold text-amber-800/60 dark:text-amber-400/60 mt-1 uppercase tracking-wider">
                BrewLite Coffee
              </span>
            </div>
          )}

          {/* Badge danh mục */}
          <span className="absolute top-2.5 left-2.5 bg-[#1f1612]/80 dark:bg-black/70 backdrop-blur-md text-amber-200 border border-amber-500/20 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-lg">
            {product.category}
          </span>

          {/* Badge tồn kho */}
          {isOutOfStock ? (
            <span className="absolute top-2.5 right-2.5 bg-rose-600/90 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg shadow-sm">
              Hết hàng
            </span>
          ) : product.stock <= 5 ? (
            <span className="absolute top-2.5 right-2.5 bg-amber-500/90 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg shadow-sm">
              Còn ít ({product.stock})
            </span>
          ) : null}
        </div>

        {/* Tên & mô tả */}
        <h3 className="font-bold text-stone-900 dark:text-stone-100 text-base group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors line-clamp-1">
          {product.name}
        </h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 line-clamp-2 min-h-[32px] leading-relaxed">
          {product.description || 'Thức uống thơm ngon được pha chế tươi mới theo công thức đặc biệt.'}
        </p>
      </div>

      {/* Giá tiền & Nút chọn */}
      <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <div>
          <span className="text-[10px] text-stone-400 uppercase tracking-wider font-semibold block">Giá từ</span>
          <span className="text-base font-extrabold text-amber-950 dark:text-amber-400 font-mono">
            {product.price.toLocaleString('vi-VN')}₫
          </span>
        </div>

        <button
          onClick={() => onSelect(product)}
          disabled={isOutOfStock}
          className="bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:from-stone-300 disabled:to-stone-300 dark:disabled:from-stone-800 dark:disabled:to-stone-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm shadow-amber-900/20 active:scale-95 cursor-pointer disabled:cursor-not-allowed"
        >
          {isOutOfStock ? 'Hết hàng' : '+ Đặt món'}
        </button>
      </div>
    </div>
  );
}
