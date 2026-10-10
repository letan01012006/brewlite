import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { sourceLoader, deferred, walk } from "./load-source.mjs";

const summary = {
  id: 1,
  code: "#1",
  status: "PAID",
  total: 50000,
  itemCount: 1,
  createdAt: "2025-01-01",
};
const result = (id = 1) => ({
  data: [{ ...summary, id, code: `#${id}` }],
  meta: { page: id, total: 21, totalPages: 2 },
});
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : typeof node !== "object"
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join("")
        : text(node.props?.children);

function harness(api) {
  let index = 0;
  const slots = [];
  const effects = [];
  const timers = new Map();
  let timerId = 0;
  const auth = {
    user: { id: 1, fullName: "Test", loyaltyPoints: 50 },
    token: "token",
    refreshes: 0,
    refreshUser: async () => {
      auth.refreshes++;
    },
  };
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const hooks = {
    ...React,
    useState: (initial) => {
      const i = index++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = value;
        },
      ];
    },
    useRef: (initial) => {
      const i = index++;
      return (slots[i] ??= { current: initial });
    },
    useCallback: (callback, deps) => {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback };
      return slots[i].callback;
    },
    useEffect: (callback, deps) => {
      const i = index++;
      if (!same(slots[i]?.deps, deps))
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: callback() };
        });
    },
  };
  const load = sourceLoader(
    {
      react: hooks,
      "next/link": "a",
      "@/store/auth-store": {
        useAuthStore: (selector) => (selector ? selector(auth) : auth),
      },
      "@/lib/api/client": { apiFetch: api, ApiError: class extends Error {} },
    },
    {
      confirm: () => true,
      alert() {},
      setTimeout: (callback) => {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const Content = load("src/app/orders/page.tsx").default().props.children.type;
  const render = () => {
    index = 0;
    return Content();
  };
  const settle = async () => {
    effects.splice(0).forEach((effect) => effect());
    const work = [...timers.values()];
    timers.clear();
    work.forEach((callback) => callback());
    await new Promise((resolve) => setImmediate(resolve));
    return render();
  };
  return { auth, render, settle };
}

test("history pagination requests page 2; an old page response cannot replace it", async () => {
  const late = deferred();
  const calls = [];
  let firstPageCalls = 0;
  const h = harness(async (path) => {
    calls.push(path);
    if (path.endsWith("page=2")) return result(21);
    if (++firstPageCalls === 2) return late.promise;
    return result();
  });
  h.render();
  let tree = await h.settle();
  const refresh = walk(
    tree,
    (node) =>
      node.type === "button" && text(node).includes("Làm mới trạng thái"),
  )[0];
  refresh.props.onClick();
  const pagination = walk(tree, (node) => node.type?.name === "Pagination")[0];
  pagination.props.onChange(2);
  h.render();
  tree = await h.settle();
  assert.ok(calls.includes("/orders/me?limit=20&page=2"));
  late.resolve(result(999));
  await new Promise((resolve) => setImmediate(resolve));
  tree = h.render();
  assert.ok(text(tree).includes("#21"));
  assert.equal(text(tree).includes("#999"), false);
});

test("successful cancellation reloads server loyalty points as well as order history", async () => {
  const calls = [];
  const h = harness(async (path) => {
    calls.push(path);
    if (path === "/orders/1")
      return {
        ...summary,
        subtotal: 50000,
        discountAmount: 0,
        pointsEarned: 50,
        items: [],
        payments: [],
      };
    return path.endsWith("/cancel") ? {} : result();
  });
  h.render();
  let tree = await h.settle();
  const detail = walk(
    tree,
    (node) =>
      node.type === "button" &&
      node.props.onClick?.toString().includes("handleViewOrderDetail"),
  )[0];
  await detail.props.onClick();
  tree = h.render();
  const cancel = walk(
    tree,
    (node) => node.type === "button" && text(node).includes("Hủy đơn hàng này"),
  )[0];
  await cancel.props.onClick();
  assert.ok(calls.includes("/orders/1/cancel"));
  assert.equal(h.auth.refreshes, 1);
  assert.equal(calls.filter((path) => path.includes("/orders/me")).length, 2);
});
