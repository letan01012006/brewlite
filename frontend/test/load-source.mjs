import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

// Run the actual TypeScript modules in isolation without a server or database.
// Type checking remains a separate `tsc --noEmit` check.
export function sourceLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    let file = path.resolve(root, relative);
    if (!path.extname(file))
      file += fs.existsSync(`${file}.ts`) ? ".ts" : ".tsx";
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(
      js,
      {
        module: loadedModule,
        exports: loadedModule.exports,
        console,
        crypto: globalThis.crypto,
        process,
        fetch,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        AbortController,
        require: (id) =>
          Object.hasOwn(mocks, id)
            ? mocks[id]
            : id.startsWith("@/")
              ? load(`src/${id.slice(2)}`)
              : require(id),
        ...globals,
      },
      { filename: file },
    );
    return loadedModule.exports;
  }
  return load;
}

export function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function walk(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node))
    return node.flatMap((child) => walk(child, predicate));
  return [
    ...(predicate(node) ? [node] : []),
    ...walk(node.props?.children, predicate),
  ];
}
