import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./load-source.mjs";

test("catalog includes products and categories after item 50 and removes duplicate IDs", async () => {
  const pages = [];
  const load = sourceLoader({
    "@/lib/api/client": {
      apiFetch: async (path) => {
        const page = Number(
          new URL(path, "http://test").searchParams.get("page"),
        );
        pages.push(page);
        return {
          data:
            page === 1
              ? Array.from({ length: 50 }, (_, i) => ({
                  id: i + 1,
                  category: "Coffee",
                }))
              : [
                  { id: 50, category: "Coffee" },
                  { id: 51, name: "Rare Tea", category: "Tea" },
                ],
          meta: { totalPages: 2 },
        };
      },
    },
  });
  const products = await load("src/lib/api/pagination.ts").allProducts();
  assert.deepEqual(pages, [1, 2]);
  assert.equal(products.length, 51);
  assert.equal(products.find((p) => p.id === 51).name, "Rare Tea");
  assert.ok(products.some((p) => p.category === "Tea"));
});

test("failed catalog page rejects the partial list instead of hiding missing products", async () => {
  const load = sourceLoader({
    "@/lib/api/client": {
      apiFetch: async (path) => {
        if (path.endsWith("page=2")) throw new Error("Offline");
        return { data: [{ id: 1 }], meta: { totalPages: 2 } };
      },
    },
  });
  await assert.rejects(
    load("src/lib/api/pagination.ts").allProducts(),
    /Offline/,
  );
});
