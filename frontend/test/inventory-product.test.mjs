import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { sourceLoader, deferred, walk } from "./load-source.mjs";

function harness(api) {
  const slots = [];
  let index = 0;
  const created = [];
  let closed = 0;
  const load = sourceLoader(
    {
      react: {
        ...React,
        useId: () => "product-test",
        useState(initial) {
          const current = index++;
          if (!(current in slots))
            slots[current] =
              typeof initial === "function" ? initial() : initial;
          return [
            slots[current],
            (value) => {
              slots[current] =
                typeof value === "function" ? value(slots[current]) : value;
            },
          ];
        },
        useRef(initial) {
          return (slots[index++] ??= { current: initial });
        },
      },
      "@/lib/api/client": { apiFetch: api, ApiError: class extends Error {} },
    },
    { Error },
  );
  const Component = load(
    "src/components/inventory/add-product-modal.tsx",
  ).AddProductModal;
  const props = {
    toppings: Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: `Topping ${i + 1}`,
      price: 1000,
      isActive: i !== 4,
    })),
    categories: ["Cà phê", "Trà"],
    onCreated: (product) => created.push(product),
    onClose: () => {
      closed++;
    },
  };
  const render = () => {
    index = 0;
    return Component(props);
  };
  const find = (predicate) => walk(render(), predicate)[0];
  const fill = (name, value) =>
    find(
      (node) => node.type === "input" && node.props.name === name,
    ).props.onChange({ target: { value } });
  const submit = () =>
    find((node) => node.type === "form").props.onSubmit({
      preventDefault() {},
    });
  function valid() {
    fill("name", "  Cà phê dừa  ");
    fill("price", "35000");
    fill("category", "  Cà phê  ");
    fill("imageUrl", " /img/coffee.jpg ");
  }
  return {
    load,
    render,
    find,
    fill,
    submit,
    valid,
    created,
    closed: () => closed,
  };
}

test("product form posts metadata and allowed toppings without stock, then hands the returned ID to recipes", async () => {
  const calls = [];
  const h = harness(async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return { id: 47, name: "Cà phê dừa", price: 35000, category: "Cà phê" };
  });
  h.valid();
  const checkboxes = walk(
    h.render(),
    (node) => node.type === "input" && node.props.type === "checkbox",
  );
  assert.equal(checkboxes.length, 4); // inactive topping hidden; no 3-topping config limit
  for (const checkbox of checkboxes)
    checkbox.props.onChange({ target: { checked: true } });
  assert.equal(
    walk(
      h.render(),
      (node) => node.type === "input" && node.props.name === "stock",
    ).length,
    0,
  );
  await h.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/products");
  assert.deepEqual(calls[0][1], {
    name: "Cà phê dừa",
    price: 35000,
    category: "Cà phê",
    imageUrl: "/img/coffee.jpg",
    toppingIds: [1, 2, 3, 4],
  });
  assert.equal(h.created[0].id, 47);
});

test("double submit does not duplicate products and the create request cannot be dismissed midway", async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness(() => {
    calls++;
    return pending.promise;
  });
  h.valid();
  const creating = h.submit();
  await h.submit();
  h.render().props.onClose();
  assert.equal(calls, 1);
  assert.equal(h.closed(), 0);
  pending.resolve({ id: 48 });
  await creating;
  assert.equal(h.created[0].id, 48);
});

test("duplicate/network failure preserves form entries and supports retry without advancing the step", async () => {
  let fail = true;
  const h = harness(async () => {
    if (fail) throw new Error("Tên món đã tồn tại");
    return { id: 49 };
  });
  h.valid();
  await h.submit();
  assert.equal(h.created.length, 0);
  assert.equal(
    h.find((node) => node.props.role === "alert").props.children,
    "Tên món đã tồn tại",
  );
  assert.equal(
    h.find((node) => node.type === "input" && node.props.name === "name").props
      .value,
    "  Cà phê dừa  ",
  );
  fail = false;
  await h.submit();
  assert.equal(h.created[0].id, 49);
});

test("product form rejects invalid names, prices and image URLs before posting", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return { id: 50 };
  });
  h.valid();
  for (const price of ["", "-1", "1.5", "2147483648"]) {
    h.fill("price", price);
    await h.submit();
  }
  h.valid();
  h.fill("name", "  ");
  await h.submit();
  h.valid();
  h.fill("category", "  ");
  await h.submit();
  h.valid();
  h.fill("imageUrl", "javascript:alert(1)");
  await h.submit();
  assert.equal(calls, 0);
});

test("create API strips legacy stock even if supplied at runtime", async () => {
  let payload;
  const h = harness(async (_, options) => {
    payload = JSON.parse(options.body);
    return {};
  });
  await h.load("src/lib/api/inventory.ts").createProduct({
    name: "Trà",
    category: "Trà",
    price: 20000,
    imageUrl: "/tea.jpg",
    toppingIds: [],
    stock: 999,
  });
  assert.equal("stock" in payload, false);
  assert.deepEqual(payload.toppingIds, []);
});
