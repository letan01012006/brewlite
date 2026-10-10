export const DEFAULT_PRODUCT_IMAGES: Record<string, string> = {
  'Cà phê sữa':
    'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=600&auto=format&fit=crop&q=80',
  Americano:
    'https://images.unsplash.com/photo-1551030173-122aabc4489c?w=600&auto=format&fit=crop&q=80',
  Cappuccino:
    'https://images.unsplash.com/photo-1534778101976-62847782c213?w=600&auto=format&fit=crop&q=80',
  'Trà đào':
    'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&auto=format&fit=crop&q=80',
  Latte:
    'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=600&auto=format&fit=crop&q=80',
  'Bạc xỉu':
    'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&auto=format&fit=crop&q=80',
  'Trà vải':
    'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format&fit=crop&q=80',
  'Trà sữa trân châu': '/img/tra-sua.jpg',
  'Trà sữa chân trâu': '/img/tra-sua.jpg',
  'Matcha đá xay':
    'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&auto=format&fit=crop&q=80',
  'Cà phê muối':
    'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=80',
};

const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  'Cà phê':
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&auto=format&fit=crop&q=80',
  Trà: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&auto=format&fit=crop&q=80',
  'Đá xay':
    'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&auto=format&fit=crop&q=80',
};

export function getProductImageUrl(
  productName: string,
  category?: string,
  imageUrl?: string | null,
): string {
  // 1. Kiểm tra chính xác theo tên trong danh mục map mặc định
  if (DEFAULT_PRODUCT_IMAGES[productName]) {
    return DEFAULT_PRODUCT_IMAGES[productName];
  }

  // 1b. Khớp không phân biệt hoa thường hoặc chính tả trà sữa
  const normalized = productName?.trim().toLowerCase();
  if (normalized) {
    if (
      normalized.includes('trà sữa') ||
      normalized.includes('tra sua') ||
      normalized.includes('chân trâu') ||
      normalized.includes('trân châu')
    ) {
      return '/img/tra-sua.jpg';
    }

    for (const [key, url] of Object.entries(DEFAULT_PRODUCT_IMAGES)) {
      if (key.toLowerCase() === normalized) {
        return url;
      }
    }
  }

  // 2. Nếu có URL từ database (/img/... hoặc http...)
  if (imageUrl && imageUrl.trim()) {
    return imageUrl.trim();
  }

  // 3. Fallback theo danh mục
  if (category && CATEGORY_FALLBACK_IMAGES[category]) {
    return CATEGORY_FALLBACK_IMAGES[category];
  }

  // 4. Default chung cho đồ uống
  return 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&auto=format&fit=crop&q=80';
}
