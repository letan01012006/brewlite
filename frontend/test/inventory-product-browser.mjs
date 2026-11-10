import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const directory =
  process.env.PRODUCT_TEST_OUTPUT ||
  fs.mkdtempSync(path.join(os.tmpdir(), "brewlite-product-report-"));
fs.mkdirSync(directory, { recursive: true });
const browser = spawn(
  process.env.CHROME_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" +
      fs.mkdtempSync(path.join(os.tmpdir(), "brewlite-product-ui-")),
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let stderr = "";
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Browser startup timeout")),
      15000,
    );
    browser.stderr.on("data", (data) => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    browser.on("error", reject);
  });
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  const writes = [];
  const exceptions = [];
  let send;
  let failM = true;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item?.reject(Error(message.error.message));
      else item?.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      if (request.method !== "GET")
        writes.push({
          path: url.pathname,
          method: request.method,
          body: request.postData ? JSON.parse(request.postData) : null,
        });
      if (
        request.method === "PUT" &&
        url.pathname.endsWith("/recipes/M") &&
        failM
      ) {
        failM = false;
        void send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 503,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from(
            JSON.stringify({
              code: "TEST_SAVE_FAILED",
              message: "Lưu size M tạm thời gián đoạn.",
            }),
          ).toString("base64"),
        });
      } else {
        void send("Fetch.continueRequest", {
          requestId,
          url: process.env.PRODUCT_TEST_API + url.pathname + url.search,
        });
      }
    } else if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails.text);
    else if (message.method === "Page.javascriptDialogOpening")
      void send("Page.handleJavaScriptDialog", { accept: true });
  };
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  send = (method, params) => call(method, params, sessionId);
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) {
      try {
        if (await evaluate(expression)) return;
      } catch {
        /* Navigation can replace the page execution context. */
      }
      await delay(100);
    }
    throw Error(
      "Timeout: " +
        expression +
        "\n" +
        (await evaluate("document.body.innerText")),
    );
  }
  const clickText = (text) =>
    evaluate(
      `([...document.querySelectorAll('dialog[open] button')].find(button => button.textContent.trim() === ${JSON.stringify(text)})).click()`,
    );
  async function input(selector, text) {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
    await send("Input.insertText", { text });
  }
  const name = "Cà phê thử hai bước";
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", {
      patterns: [
        { urlPattern: "http://localhost:3000/api/*", requestStage: "Request" },
      ],
    });
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem('brewlite_token',${JSON.stringify(process.env.PRODUCT_TEST_TOKEN)});`,
    });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1365,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", {
      url: "http://localhost:3000/barista/inventory",
    });
    await until(
      `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='+ Thêm món' && !b.disabled)`,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Thêm món').click()`,
    );
    await input('dialog [name="name"]', name);
    await input('dialog [name="price"]', "35000");
    await input('dialog [name="category"]', "Cà phê");
    await input('dialog [name="imageUrl"]', "/img/default.jpg");
    assert.equal(
      await evaluate('!!document.querySelector("dialog [name=stock]")'),
      false,
    );
    await evaluate(
      `document.querySelectorAll('dialog [name="toppingIds"]').forEach(input=>{if(input.closest('label').textContent.trim().startsWith('Topping '))input.click()})`,
    );
    fs.writeFileSync(
      path.join(directory, "product-setup-step1.png"),
      Buffer.from(
        (await send("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
    await clickText("Tạo món và gán công thức →");
    await until(
      `document.querySelector('dialog #recipe-modal-title')?.textContent.trim()===${JSON.stringify(name)}`,
    );
    await until(
      `!document.querySelector('dialog').textContent.includes('Đang tải công thức')`,
    );
    await evaluate(
      'document.querySelector("dialog button[aria-label=Đóng]").click()',
    );
    await until('!document.querySelector("dialog[open]")');
    const openCard = `document.querySelector('button[aria-label="Xem công thức ${name}"]')`;
    await until(`!!${openCard}`);
    assert.equal(
      await evaluate(
        `${openCard}.closest('.group').textContent.match(/Chưa có công thức/g)?.length`,
      ),
      3,
    );
    await evaluate(`${openCard}.click()`);
    await until(
      `!document.querySelector('dialog').textContent.includes('Đang tải công thức')`,
    );
    await clickText("+ Thêm nguyên liệu vào công thức");
    await input('dialog input[aria-label^="Định lượng"]', "50");
    await clickText("Lưu công thức Size S");
    await until(
      `document.querySelector('dialog').textContent.includes('Đã lưu công thức') && !document.querySelector('dialog').textContent.includes('Đang lưu…')`,
    );
    await evaluate(
      'document.querySelector("dialog button[aria-label=Đóng]").click()',
    );
    await until('!document.querySelector("dialog[open]")');
    await send("Page.reload");
    await until(`!!${openCard}`);
    await until(`${openCard}.closest('.group').textContent.includes('20 ly')`);
    await evaluate(`${openCard}.click()`);
    await until(
      `!document.querySelector('dialog').textContent.includes('Đang tải công thức')`,
    );
    assert.equal(
      await evaluate(
        'document.querySelector("dialog input[aria-label^=Định]").value',
      ),
      "50",
    );
    await evaluate(
      `document.querySelector('button[aria-label="Công thức size M"]').click()`,
    );
    await until(
      `!document.querySelector('dialog').textContent.includes('Đang tải công thức')`,
    );
    await clickText("+ Thêm nguyên liệu vào công thức");
    await input('dialog input[aria-label^="Định lượng"]', "100");
    await clickText("Lưu công thức Size M");
    await until(
      `document.querySelector('dialog').textContent.includes('Lưu size M tạm thời gián đoạn.')`,
    );
    assert.equal(
      await evaluate(
        'document.querySelector("dialog input[aria-label^=Định]").value',
      ),
      "100",
    );
    await clickText("Lưu công thức Size M");
    await until(
      `document.querySelector('dialog').textContent.includes('Đã lưu công thức') && !document.querySelector('dialog').textContent.includes('Đang lưu…')`,
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    fs.writeFileSync(
      path.join(directory, "product-setup-step2-mobile.png"),
      Buffer.from(
        (await send("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
    await evaluate(
      'document.querySelector("dialog button[aria-label=Đóng]").click()',
    );
    await until('!document.querySelector("dialog[open]")');
    await until(`${openCard}.closest('.group').textContent.includes('10 ly')`);
    const summary = await evaluate(`${openCard}.closest('.group').textContent`);
    assert(summary.includes("20 ly"));
    assert(summary.includes("10 ly"));
    assert(summary.includes("Chưa có công thức"));
    const posts = writes.filter(
      (row) => row.method === "POST" && row.path === "/api/products",
    );
    assert.equal(posts.length, 1);
    assert.equal("stock" in posts[0].body, false);
    assert.equal(posts[0].body.toppingIds.length, 4);
    const puts = writes.filter((row) => row.method === "PUT");
    assert.equal(puts.filter((row) => row.path.endsWith("/S")).length, 1);
    assert.equal(puts.filter((row) => row.path.endsWith("/M")).length, 2);
    assert.equal(puts.filter((row) => row.path.endsWith("/L")).length, 0);
    assert.deepEqual(exceptions, []);
    const productId = Number(puts[0].path.split("/")[3]);
    const report = {
      status: "PASS",
      productId,
      sourceDatabaseTouched: false,
      checks: [
        "Two-step creation without stock",
        "Four allowed toppings",
        "Close before recipe and resume",
        "S saved and survives reload",
        "Failed M save retains input and saved S",
        "M retry succeeds, L remains unconfigured",
        "S=20 cups, M=10 cups from 1000g stock",
        "Desktop/mobile UI",
        "No runtime exceptions",
      ],
      writes,
    };
    fs.writeFileSync(
      path.join(directory, "product-setup-browser.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ status: report.status, checks: report.checks }),
    );
  } finally {
    await call("Browser.close").catch(() => {});
    ws.close();
  }
} catch (error) {
  console.error(error);
  browser.kill();
  process.exitCode = 1;
}
