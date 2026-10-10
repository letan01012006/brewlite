import { apiFetch } from "@/lib/api/client";
import type { PaginatedResponse } from "@/types";

// Load the complete small coffee catalog so category/search can include every
// product. Display pagination is separate from API pagination.
export async function allProducts<T extends { id: number }>(
  signal?: AbortSignal,
): Promise<T[]> {
  const items = new Map<number, T>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = await apiFetch<PaginatedResponse<T>>(
      `/products?limit=50&page=${page}`,
      { signal, auth: false },
    );
    response.data.forEach((item) => items.set(item.id, item));
    totalPages = response.meta.totalPages;
    page++;
  } while (page <= totalPages);
  return [...items.values()];
}
