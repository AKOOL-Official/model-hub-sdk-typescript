import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ModelHub,
  SubmissionUnknownError,
  TaskWaitTimeoutError,
  TaskFailedError,
  UnsupportedCapabilityError,
  convertSchema,
} from "../dist/index.js";

const task = {
  task_uuid: "task-1",
  model_id: "example/video",
  status: "completed",
  output: { video_url: "https://example.com/v.mp4", nested_key: { a_b: 1 } },
};
const respond = (json, status = 200, headers = {}) =>
  new Response(JSON.stringify(json), { status, headers });
const client = (fetcher, options = {}) =>
  new ModelHub({
    apiKey: "sk-test",
    baseUrl: "https://example.com/gateway/api/v1",
    fetch: fetcher,
    ...options,
  });

test("preserves gateway path and dynamic input/output keys", async () => {
  const calls = [];
  const sdk = client(async (url, init) => {
    if (url.pathname.endsWith("capabilities")) return respond({}, 404);
    calls.push([url, init]);
    if (init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body).input, { keep_key: 1 });
      return respond({ task_uuid: "task-1", status: "pending" });
    }
    return respond(task, 200, { "X-Request-Id": "read-id" });
  });
  const created = await sdk.tasks.create({
    modelId: "example/video model",
    input: { keep_key: 1 },
  });
  const result = await sdk.tasks.wait(created.taskUuid);
  assert.equal(
    calls[0][0].pathname,
    "/gateway/api/v1/run/example/video%20model",
  );
  assert.equal(calls[0][1].headers.Authorization, "Bearer sk-test");
  assert.deepEqual(result.output.nested_key, { a_b: 1 });
  assert.equal(result.requestId, "read-id");
});

for (const modelId of [
  "../x",
  "%2e%2e/x",
  "%252e%252e/x",
  "https://bad/x",
  "a\\b",
  "a//b",
]) {
  test(`rejects unsafe model ID ${modelId}`, async () => {
    await assert.rejects(
      client(() => assert.fail("must not send")).tasks.create({
        modelId,
        input: {},
      }),
    );
  });
}

test("does not retry a non-idempotent POST and retains candidate ID", async () => {
  let calls = 0;
  const sdk = client(async (url) => {
    if (url.pathname.endsWith("capabilities")) return respond({}, 404);
    calls++;
    throw new TypeError("response lost");
  });
  await assert.rejects(
    sdk.tasks.create({ modelId: "m", input: {}, requestId: "original" }),
    (e) => {
      assert(e instanceof SubmissionUnknownError);
      assert.equal(e.candidateTaskUuid, "original");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("idempotent retry uses identical body and key", async () => {
  const calls = [];
  const sdk = client(async (url, init) => {
    if (url.pathname.endsWith("capabilities"))
      return respond({
        run_idempotency_v1: true,
        idempotency_header: "X-Request-Id",
      });
    calls.push(init);
    if (calls.length === 1)
      return respond({ error: { code: "idempotency_in_progress" } }, 409, {
        "Retry-After": "0",
      });
    return respond({ task_uuid: "server-task", status: "pending" });
  });
  assert.equal(
    (
      await sdk.tasks.create({
        modelId: "m",
        input: { prompt: "x" },
        requestId: "order-1",
      })
    ).taskUuid,
    "server-task",
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(
    calls[0].headers["X-Request-Id"],
    calls[1].headers["X-Request-Id"],
  );
});

test("legacy capabilities allow a single POST without automatic retries", async () => {
  let calls = 0;
  const sdk = client(async (_url, init) => {
    if (init.method === "GET") return respond({}, 404);
    calls++;
    return respond({}, 503);
  });
  await assert.rejects(
    sdk.tasks.create({ modelId: "m", input: {}, requestId: "k" }),
    SubmissionUnknownError,
  );
  assert.equal(calls, 1);
});

test("failed task is distinct from wait timeout", async () => {
  await assert.rejects(
    client(async () => respond({ ...task, status: "failed" })).tasks.wait(
      "task-1",
    ),
    (e) => e instanceof TaskFailedError && e.taskUuid === "task-1",
  );
  await assert.rejects(
    client(async () => respond({ ...task, status: "future-state" })).tasks.wait(
      "task-1",
      { timeoutMs: 5 },
    ),
    (e) =>
      e instanceof TaskWaitTimeoutError && e.task.status === "future-state",
  );
});

test("abort stops waiting without making a cancel request", async () => {
  const calls = [];
  const sdk = client(async (_url, init) => {
    calls.push(init.method);
    return respond({ ...task, status: "processing" });
  });
  await assert.rejects(
    sdk.tasks.wait("task-1", { signal: AbortSignal.timeout(5) }),
  );
  assert.deepEqual(calls, ["GET"]);
});

test("wait deadline covers a slow HTTP request", async () => {
  const sdk = client(
    async (_url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const start = performance.now();
  await assert.rejects(
    sdk.tasks.wait("task-1", { timeoutMs: 10 }),
    TaskWaitTimeoutError,
  );
  assert(performance.now() - start < 250);
});

test("Python and TypeScript use the same schema and canonical hash", async () => {
  const input = JSON.parse(
    await readFile(
      new URL("../contracts/fixtures/model.json", import.meta.url),
      "utf8",
    ),
  );
  const expected = JSON.parse(
    await readFile(
      new URL("../contracts/fixtures/schema.json", import.meta.url),
      "utf8",
    ),
  );
  const schema = await convertSchema({
    modelId: input.model_id,
    parameters: input.parameters,
    outputSchema: input.output_schema,
  });
  assert.deepEqual(schema.inputSchema, expected.input_schema);
  assert.equal(schema.schemaHash, expected.schema_hash);
  assert.deepEqual(schema.warnings, expected.warnings);
});

for (const status of [401, 403, 404]) {
  test(`key-scoped catalog rechecks authorization and does not fall back on ${status}`, async () => {
    const calls = [];
    let revoked = false;
    const sdk = client(async (url) => {
      calls.push(url.pathname);
      assert(url.pathname.startsWith('/gateway/api/v1/client/models'));
      if (revoked) return respond({}, status);
      if (url.pathname.endsWith('/detail')) return respond({model_id: 'private-model', parameters: []});
      if (url.pathname.endsWith('/lang')) return respond({content: 'private documentation'});
      return respond({items: [{model_id: 'private-model', parameters: []}], total: 1});
    });
    assert.equal((await sdk.models.list()).items[0].modelId, 'private-model');
    await sdk.models.get('private-model');
    await sdk.models.documentation('private-model');
    revoked = true;
    await assert.rejects(sdk.models.list(), (e) => e.statusCode === status);
    await assert.rejects(sdk.models.get('private-model'), (e) => e.statusCode === status);
    await assert.rejects(sdk.models.documentation('private-model'), (e) => e.statusCode === status);
    assert.equal(calls.length, 6);
  });
}

test('branded environment variables are used without CLI configuration', async () => {
  const names = ['AKOOL_MODELHUB_API_KEY', 'AKOOL_MODELHUB_BASE_URL'];
  const previous = names.map((name) => process.env[name]);
  try {
    process.env.AKOOL_MODELHUB_API_KEY = 'sk-environment';
    process.env.AKOOL_MODELHUB_BASE_URL = 'https://example.invalid/api/v1';
    const sdk = new ModelHub({fetch: async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer sk-environment');
      assert.equal(url.pathname, '/api/v1/client/models');
      return respond({items: [], total: 0});
    }});
    await sdk.models.list();
  } finally {
    names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]);
  }
});
