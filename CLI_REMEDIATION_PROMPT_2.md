# 🚨 HIGH PRIORITY: TEST FAILURE REMEDIATION REQUIRED (Round 2/3)

## Context:
- Repository: Arenax-gaming/ArenaX
- Issue Number: #1149
- Primary Target File: `backend/src/auth/mod.rs`
- Native Test Command: `make test`

## Test Failure Traceback:
The execution of `make test` failed with the following errors/traceback:
```
      24 | import type { BracketPlayer } from "@/types/bracket";

      at Runtime.createScriptFromCode (node_modules/jest-runtime/build/index.js:1505:14)
      at Object.require (src/__tests__/bracket-seeding-editor.test.tsx:21:1)

FAIL src/__tests__/tournament-prefetch.test.tsx
  ● Test suite failed to run

    ReferenceError: /Users/fangqq/Code/bounty-workspaces/Arenax-gaming_ArenaX_issue_1149/frontend/src/__tests__/tournament-prefetch.test.tsx: The module factory of `jest.mock()` is not allowed to reference any out-of-scope variables.
    Invalid variable access: prefetchMock
    Allowed objects: AbortController, AbortSignal, AggregateError, Array, ArrayBuffer, AsyncDisposableStack, Atomics, BigInt, BigInt64Array, BigUint64Array, Blob, Boolean, BroadcastChannel, Buffer, ByteLengthQueuingStrategy, CloseEvent, CompressionStream, CountQueuingStrategy, Crypto, CryptoKey, CustomEvent, DOMException, DataView, Date, DecompressionStream, DisposableStack, Error, ErrorEvent, EvalError, Event, EventTarget, File, FinalizationRegistry, Float16Array, Float32Array, Float64Array, FormData, Function, Generator, GeneratorFunction, Headers, Infinity, Int16Array, Int32Array, Int8Array, InternalError, Intl, Iterator, JSON, Map, Math, MessageChannel, MessageEvent, MessagePort, NaN, Navigator, Number, Object, Performance, PerformanceEntry, PerformanceMark, PerformanceMeasure, PerformanceObserver, PerformanceObserverEntryList, PerformanceResourceTiming, Promise, Proxy, RangeError, ReadableByteStreamController, ReadableStream, ReadableStreamBYOBReader, ReadableStreamBYOBRequest, ReadableStreamDefaultController, ReadableStreamDefaultReader, ReferenceError, Reflect, RegExp, Request, Response, Set, SharedArrayBuffer, Storage, String, SubtleCrypto, SuppressedError, Symbol, SyntaxError, TextDecoder, TextDecoderStream, TextEncoder, TextEncoderStream, TransformStream, TransformStreamDefaultController, TypeError, URIError, URL, URLPattern, URLSearchParams, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakRef, WeakSet, WebAssembly, WebSocket, WritableStream, WritableStreamDefaultController, WritableStreamDefaultWriter, __dirname, __filename, arguments, atob, btoa, clearImmediate, clearInterval, clearTimeout, console, crypto, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, eval, expect, exports, fetch, global, globalThis, isFinite, isNaN, jest, localStorage, module, navigator, parseFloat, parseInt, performance, process, queueMicrotask, require, sessionStorage, setImmediate, setInterval, setTimeout, structuredClone, undefined, unescape.
    Note: This is a precaution to guard against uninitialized mock variables. If it is ensured that the mock is required lazily, variable names prefixed with `mock` (case insensitive) are permitted.

      23 | jest.mock("@tanstack/react-query", () => ({
      24 |   useQueryClient: () => ({
    > 25 |     prefetchQuery: prefetchMock,
         |                    ^^^^^^^^^^^^
      26 |     cancelQueries: cancelQueriesMock,
      27 |   }),
      28 | }));

      at File.buildCodeFrameError (node_modules/@babel/core/src/transformation/file/file.ts:251:12)
      at NodePath.buildError [as buildCodeFrameError] (node_modules/@babel/traverse/src/path/index.ts:161:21)
      at call (node_modules/@babel/traverse/src/visitors.ts:299:14)
      at NodePath.call [as _call] (node_modules/@babel/traverse/src/path/context.ts:36:20)
      at NodePath.call (node_modules/@babel/traverse/src/path/context.ts:21:18)
      at NodePath.call [as visit] (node_modules/@babel/traverse/src/path/context.ts:97:31)
      at TraversalContext.visit [as visitQueue] (node_modules/@babel/traverse/src/context.ts:161:16)
      at TraversalContext.visitQueue [as visitMultiple] (node_modules/@babel/traverse/src/context.ts:109:17)
      at TraversalContext.visitMultiple [as visit] (node_modules/@babel/traverse/src/context.ts:192:19)
      at visit (node_modules/@babel/traverse/src/traverse-node.ts:208:17)
      at NodePath.visit (node_modules/@babel/traverse/src/path/context.ts:104:33)
      at TraversalContext.visit [as visitQueue] (node_modules/@babel/traverse/src/context.ts:161:16)
      at TraversalContext.visitQueue [as visitSingle] (node_modules/@babel/traverse/src/context.ts:119:19)
      at TraversalContext.visitSingle [as visit] (node_modules/@babel/traverse/src/context.ts:194:19)
      at visit (node_modules/@babel/traverse/src/traverse-node.ts:208:17)
      at traverse (node_modules/@babel/traverse/src/index.ts:84:15)
      at transformFile (node_modules/@babel/core/src/transformation/index.ts:120:15)
          at transformFile.next (<anonymous>)
      at transformFile (node_modules/@babel/core/src/transformation/index.ts:50:12)
          at run.next (<anonymous>)
      at transform (node_modules/@babel/core/src/transform.ts:29:20)
          at transform.next (<anonymous>)
      at evaluateSync (node_modules/gensync/index.js:251:28)
      at sync (node_modules/gensync/index.js:89:14)
      at fn (node_modules/@babel/core/src/errors/rewrite-stack-trace.ts:99:14)
      at transformSync (node_modules/@babel/core/src/transform.ts:66:52)
      at ScriptTransformer.transformSource (node_modules/@jest/transform/build/ScriptTransformer.js:545:31)
      at ScriptTransformer._transformAndBuildScript (node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
      at ScriptTransformer.transform (node_modules/@jest/transform/build/ScriptTransformer.js:726:19)


Test Suites: 9 failed, 85 passed, 94 total
Tests:       22 failed, 1736 passed, 1758 total
Snapshots:   0 total
Time:        7.207 s
Ran all test suites.
error Command failed with exit code 1.
info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
make: *** [test-frontend] Error 1
```

## Remediation Directive:
1. Inspect the traceback and error messages above carefully.
2. Modify `backend/src/auth/mod.rs` directly in-place to fix the assertion failures, type errors, or unhandled exceptions.
3. Immediately run `make test` to verify your fix.
4. Continue adjusting `backend/src/auth/mod.rs` until `make test` passes 100% with ZERO failures and ZERO errors.
5. Do NOT disable, weaken, or delete the failing tests. Solve the underlying defect!
