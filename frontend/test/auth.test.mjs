import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, memoryStorage, deferred } from "./load-source.mjs";

const customer = {
  id: 1,
  fullName: "Customer",
  email: "customer@test",
  role: "CUSTOMER",
  loyaltyPoints: 10,
};
function fixture(fetcher, storage = memoryStorage()) {
  const load = sourceLoader(
    {},
    { window: {}, localStorage: storage, fetch: fetcher },
  );
  return {
    load,
    storage,
    auth: load("src/store/auth-store.ts").useAuthStore,
    cart: load("src/store/cart-store.ts").useCartStore,
    api: load("src/lib/api/client.ts").apiFetch,
  };
}
const response = (status, body) => ({
  ok: status < 400,
  status,
  statusText: "Test",
  json: async () => body,
});

test("sign-in remains usable in memory when browser storage rejects writes", async () => {
  const storage = {
    ...memoryStorage(),
    setItem() {
      throw new Error("Storage full");
    },
  };
  const { auth } = fixture(async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer memory-token");
    return response(200, { ...customer, loyaltyPoints: 30 });
  }, storage);
  auth.getState().setAuth(customer, "memory-token");
  await auth.getState().refreshUser();
  assert.equal(auth.getState().user.loyaltyPoints, 30);
});

test("startup verifies token with /auth/me and ignores forged cached profile", async () => {
  const storage = memoryStorage();
  storage.setItem("brewlite_token", "token");
  storage.setItem(
    "brewlite_user",
    JSON.stringify({ ...customer, role: "BARISTA", loyaltyPoints: 999999 }),
  );
  const pending = deferred();
  let calls = 0;
  const { auth } = fixture(async (url, options) => {
    calls++;
    assert.ok(url.endsWith("/auth/me"));
    assert.equal(options.headers.Authorization, "Bearer token");
    return pending.promise;
  }, storage);
  const first = auth.getState().initAuth();
  const second = auth.getState().initAuth();
  assert.equal(auth.getState().user, null);
  assert.equal(auth.getState().isLoading, true);
  pending.resolve(response(200, customer));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(auth.getState().user.role, "CUSTOMER");
  assert.equal(auth.getState().user.loyaltyPoints, 10);
});

test("401 clears the session and private cart view, retaining the account cart for re-login", async () => {
  const { auth, cart, api, storage } = fixture(async () =>
    response(401, { code: "UNAUTHORIZED", message: "Expired" }),
  );
  auth.getState().setAuth(customer, "expired");
  cart.getState().addItem({
    product: { id: 1, price: 50000, stock: 5 },
    size: "S",
    quantity: 1,
    selectedToppings: [],
  });
  await assert.rejects(api("/orders/me"));
  assert.equal(auth.getState().user, null);
  assert.equal(auth.getState().token, null);
  assert.equal(storage.getItem("brewlite_token"), null);
  assert.equal(cart.getState().items.length, 0);
  auth.getState().setAuth(customer, "new-token");
  assert.equal(cart.getState().items.length, 1);
});

test("late 401 from an old account does not log out the new account", async () => {
  const pending = deferred();
  const { auth, api } = fixture(() => pending.promise);
  auth.getState().setAuth(customer, "old");
  const request = api("/orders/me");
  auth.getState().setAuth({ ...customer, id: 2 }, "new");
  pending.resolve(response(401, { message: "Expired" }));
  await assert.rejects(request);
  assert.equal(auth.getState().token, "new");
  assert.equal(auth.getState().user.id, 2);
});

test("failed login does not expire an existing session", async () => {
  const { auth, api } = fixture(async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return response(401, { message: "Wrong password" });
  });
  auth.getState().setAuth(customer, "valid");
  await assert.rejects(api("/auth/login", { method: "POST", auth: false }));
  assert.equal(auth.getState().token, "valid");
});

test("latest profile refresh wins; logout prevents an old response restoring the user", async () => {
  const requests = [];
  const { auth } = fixture(() => {
    const pending = deferred();
    requests.push(pending);
    return pending.promise;
  });
  auth.getState().setAuth(customer, "token");
  const first = auth.getState().refreshUser();
  const second = auth.getState().refreshUser();
  requests[1].resolve(response(200, { ...customer, loyaltyPoints: 55 }));
  await second;
  requests[0].resolve(response(200, customer));
  await first;
  assert.equal(auth.getState().user.loyaltyPoints, 55);
  const third = auth.getState().refreshUser();
  auth.getState().logout();
  requests[2].resolve(response(200, { ...customer, loyaltyPoints: 100 }));
  await third;
  assert.equal(auth.getState().user, null);
});

test("network failure retains token for retry and does not trust cached user", async () => {
  let offline = true;
  const storage = memoryStorage();
  storage.setItem("brewlite_token", "token");
  const { auth } = fixture(async () => {
    if (offline) throw new Error("Offline");
    return response(200, customer);
  }, storage);
  await auth.getState().initAuth();
  assert.equal(auth.getState().token, "token");
  assert.equal(auth.getState().user, null);
  assert.ok(auth.getState().error);
  offline = false;
  await auth.getState().refreshUser();
  assert.equal(auth.getState().user.id, 1);
  assert.equal(auth.getState().error, null);
});

test("storage token removal and account change are synchronized without reload", async () => {
  const { auth, storage } = fixture(async (_url, options) =>
    response(200, {
      ...customer,
      id: options.headers.Authorization === "Bearer second" ? 2 : 1,
    }),
  );
  auth.getState().setAuth(customer, "first");
  storage.setItem("brewlite_token", "second");
  await auth.getState().initAuth();
  assert.equal(auth.getState().user.id, 2);
  storage.removeItem("brewlite_token");
  await auth.getState().initAuth();
  assert.equal(auth.getState().user, null);
});

test("protected gate hides private content and redirects guests / wrong role", () => {
  const effects = [];
  const redirects = [];
  const privateContent = { secret: "private orders" };
  let state = {
    user: null,
    token: null,
    isLoading: false,
    initAuth() {},
    refreshUser() {},
  };
  const load = sourceLoader({
    react: { useEffect: (callback) => effects.push(callback) },
    "next/navigation": {
      useRouter: () => ({ replace: (path) => redirects.push(path) }),
    },
    "@/store/auth-store": { useAuthStore: () => state },
  });
  const { AuthGate } = load("src/components/auth/auth-gate.tsx");
  assert.notEqual(
    AuthGate({ children: privateContent, path: "/orders" }),
    privateContent,
  );
  effects.splice(0).forEach((effect) => effect());
  assert.equal(redirects[0], "/login?redirect=%2Forders");
  state = { ...state, token: "token", user: customer };
  assert.equal(
    AuthGate({ children: privateContent, path: "/barista", barista: true }),
    null,
  );
  effects.splice(0).forEach((effect) => effect());
  assert.equal(redirects.at(-1), "/");
  assert.equal(
    AuthGate({ children: privateContent, path: "/orders" }),
    privateContent,
  );
});
