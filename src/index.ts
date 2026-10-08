import { convertSchema, type JsonObject } from "./schema.js";
export { convertSchema, type JsonObject } from "./schema.js";

export interface ErrorOptions {
  statusCode?: number;
  code?: string;
  requestId?: string | null;
  retryAfter?: number;
  details?: unknown;
}
export class ModelHubError extends Error {
  statusCode?: number;
  code: string;
  requestId?: string | null;
  retryAfter?: number;
  details?: unknown;
  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? "client_error";
    Object.assign(this, options);
  }
}
export class AuthenticationError extends ModelHubError {}
export class PermissionDeniedError extends ModelHubError {}
export class BillingError extends ModelHubError {}
export class RateLimitError extends ModelHubError {}
export class ValidationError extends ModelHubError {}
export class NotFoundError extends ModelHubError {}
export class UnsupportedCapabilityError extends ModelHubError {}
export class ProtocolError extends ModelHubError {}
export class SubmissionUnknownError extends ModelHubError {
  candidateTaskUuid?: string;
  constructor(
    message: string,
    options: ErrorOptions & { candidateTaskUuid?: string },
  ) {
    super(message, options);
    this.candidateTaskUuid = options.candidateTaskUuid;
  }
}
export class TaskError extends ModelHubError {
  constructor(
    message: string,
    public taskUuid: string,
    public task?: Task,
  ) {
    super(message);
  }
}
export class TaskFailedError extends TaskError {}
export class TaskCancelledError extends TaskError {}
export class TaskWaitTimeoutError extends TaskError {}
export interface Model {
  modelId: string;
  parameters: JsonObject[];
  outputSchema: JsonObject | null;
  examples: JsonObject[];
  requestId: string | null;
  [key: string]: unknown;
}
export interface TaskSubmission {
  taskUuid: string;
  status: string;
  estimatedTime?: number | null;
  amount?: number | null;
  requestId: string | null;
}
export interface Task extends TaskSubmission {
  modelId: string;
  output: JsonObject | null;
  errorMessage: string | null;
  createdAt: string | null;
  completedAt: string | null;
  [key: string]: unknown;
}
export interface Page<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
  requestId: string | null;
}
export interface Capabilities {
  contractVersion?: string;
  runIdempotencyV1: boolean;
  idempotencyHeader?: string;
  taskReadApiKeyScope?: boolean;
  uploadsApiKey?: boolean;
  pricePreviewPreparedInput?: boolean;
}
export interface PricePreview {
  listPrice: number;
  discountRate: number;
  finalPrice: number;
  discountReason: string | null;
  youSave: number;
  pricingWindow: string | null;
  requestId: string | null;
}
export interface Options {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}
export interface CreateOptions {
  modelId: string;
  input: JsonObject;
  webhookUrl?: string;
  requestId?: string;
  signal?: AbortSignal;
}
export interface WaitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
interface RequestOptions {
  params?: JsonObject;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
  signal?: AbortSignal;
  deadline?: number;
}

function safeId(value: string, model = false): string {
  if (typeof value !== "string" || !value || value.length > (model ? 100 : 36))
    throw new Error("Invalid model or task ID");
  let decoded = value;
  try {
    for (let i = 0; i < 5; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw new Error("Unsafe model or task ID");
  }
  if (
    /[:\\%\x00-\x1f\x7f]/.test(decoded) ||
    decoded.split("/").some((p) => ["", ".", ".."].includes(p)) ||
    (!model && decoded.includes("/"))
  )
    throw new Error("Unsafe model or task ID");
  return value
    .split("/")
    .map((p) =>
      encodeURIComponent(p).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}
function pageArgs(skip = 0, limit = 20) {
  if (
    !Number.isInteger(skip) ||
    !Number.isInteger(limit) ||
    skip < 0 ||
    limit < 1 ||
    limit > 100
  )
    throw new Error("Invalid pagination");
  return { skip, limit };
}
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function camel(data: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
}
function model(data: unknown): Model {
  if (!object(data) || typeof data.model_id !== "string")
    throw new ProtocolError("Invalid model response");
  return {
    parameters: [],
    outputSchema: null,
    examples: [],
    requestId: null,
    ...camel(data),
    modelId: data.model_id,
  } as Model;
}
function submission(data: JsonObject): TaskSubmission {
  if (typeof data.task_uuid !== "string" || typeof data.status !== "string")
    throw new ProtocolError("Invalid task response");
  return camel(data) as unknown as TaskSubmission;
}
function task(data: JsonObject): Task {
  submission(data);
  if (typeof data.model_id !== "string")
    throw new ProtocolError("Invalid task response");
  return {
    output: null,
    errorMessage: null,
    createdAt: null,
    completedAt: null,
    ...camel(data),
  } as Task;
}
function page<T>(
  data: JsonObject,
  skip: number,
  limit: number,
  decode: (data: JsonObject) => T,
): Page<T> {
  if (!Array.isArray(data.items) || typeof data.total !== "number")
    throw new ProtocolError("Invalid page response");
  return {
    items: data.items.map((item) => {
      if (!object(item)) throw new ProtocolError("Invalid page item");
      return decode(item);
    }),
    total: data.total,
    skip,
    limit,
    requestId: data.request_id as string | null,
  };
}
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function retryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const num = Number(header);
  const value = Number.isNaN(num)
    ? (Date.parse(header) - Date.now()) / 1000
    : num;
  return Number.isFinite(value) ? Math.max(0, value) : undefined;
}
function errorFrom(response: Response, data: unknown): ModelHubError {
  const error = object(data) && object(data.error) ? data.error : {};
  const ctor =
    (
      {
        400: ValidationError,
        401: AuthenticationError,
        402: BillingError,
        403: PermissionDeniedError,
        404: NotFoundError,
        422: ValidationError,
        429: RateLimitError,
      } as Record<number, typeof ModelHubError>
    )[response.status] ?? ModelHubError;
  return new ctor(
    String(error.message ?? `Model Hub HTTP ${response.status}`),
    {
      statusCode: response.status,
      code: String(error.code ?? "http_error"),
      requestId:
        response.headers.get("X-Request-Id") ??
        (error.request_id as string | undefined),
      retryAfter: retryAfter(response.headers.get("Retry-After")),
      details: error.details,
    },
  );
}

export class ModelHub {
  private readonly base: string;
  private readonly key: string;
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly cache = new Map<
    string,
    { expires: number; data: JsonObject }
  >();
  readonly models: Models;
  readonly pricing: Pricing;
  readonly tasks: Tasks;
  constructor(options: Options = {}) {
    const env =
      (
        globalThis as typeof globalThis & {
          process?: { env: Record<string, string | undefined> };
        }
      ).process?.env ?? {};
    const key = options.apiKey ?? env.AKOOL_MODELHUB_API_KEY,
      base = options.baseUrl ?? env.AKOOL_MODELHUB_BASE_URL;
    if (!key || !base)
      throw new Error("AKOOL_MODELHUB_API_KEY and AKOOL_MODELHUB_BASE_URL are required");
    const url = new URL(base);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid API base URL");
    this.base = base.replace(/\/+$/, "") + "/";
    this.key = key;
    this.fetcher = options.fetch ?? fetch;
    this.timeout = options.timeoutMs ?? 90_000;
    this.retries = options.maxRetries ?? 2;
    if (
      !Number.isFinite(this.timeout) ||
      this.timeout <= 0 ||
      !Number.isInteger(this.retries) ||
      this.retries < 0 ||
      this.retries > 10
    )
      throw new Error("Invalid timeout or maxRetries");
    this.models = new Models(this);
    this.pricing = new Pricing(this);
    this.tasks = new Tasks(this);
  }
  /** @internal */
  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<JsonObject> {
    const url = new URL(path, this.base);
    if (
      url.origin !== new URL(this.base).origin ||
      !url.pathname.startsWith(new URL(this.base).pathname)
    )
      throw new Error("Request must remain within the configured API root");
    for (const [key, value] of Object.entries(options.params ?? {}))
      if (value != null) url.searchParams.set(key, String(value));
    const deadline = Math.min(
      options.deadline ?? Infinity,
      performance.now() + this.timeout,
    );
    // Serialize before sending. Invalid JSON is a local validation error, never an unknown submission.
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    let error: ModelHubError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      options.signal?.throwIfAborted();
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      const controller = new AbortController();
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException("Operation timed out", "TimeoutError"),
          ),
        Math.ceil(remaining),
      );
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      let temporary = false;
      try {
        const response = await this.fetcher(url, {
          method,
          body,
          signal,
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "User-Agent": "akool-modelhub-sdk-typescript/0.1.0",
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
        });
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          data = undefined;
        }
        if (response.ok) {
          if (!object(data))
            throw new ProtocolError("Invalid Model Hub response", {
              code: "invalid_response",
            });
          return { ...data, request_id: response.headers.get("X-Request-Id") };
        }
        error = errorFrom(response, data);
        temporary =
          [502, 503, 504].includes(response.status) ||
          (response.status === 409 &&
            error.code === "idempotency_in_progress") ||
          (response.status === 429 &&
            error.retryAfter !== undefined &&
            error.retryAfter <= 60 &&
            response.headers.get("X-RateLimit-Scope") !== "api_key_model" &&
            !error.message.toLowerCase().includes("quota"));
      } catch (cause) {
        if (cause instanceof ModelHubError) throw cause;
        options.signal?.throwIfAborted();
        error = new ModelHubError("Model Hub connection failed or timed out", {
          code: "transport_error",
        });
        temporary = true;
      } finally {
        clearTimeout(timer);
      }
      if (options.retry === false || !temporary || attempt === this.retries)
        break;
      const delay =
        error.retryAfter !== undefined
          ? error.retryAfter * 1000
          : (250 + Math.random() * 250) * 2 ** attempt;
      if (delay >= deadline - performance.now()) break;
      await sleep(delay, options.signal);
    }
    throw (
      error ??
      new ModelHubError("Operation deadline exceeded", { code: "timeout" })
    );
  }
  /** @internal */
  async cached(
    path: string,
    params: JsonObject,
    ttl: number,
    refresh = false,
  ): Promise<JsonObject> {
    const key = path + JSON.stringify(params),
      entry = this.cache.get(key);
    if (!refresh && entry && entry.expires > performance.now())
      return structuredClone(entry.data);
    const data = await this.request("GET", path, { params });
    if (this.cache.size >= 128)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, {
      expires: performance.now() + ttl,
      data: structuredClone(data),
    });
    return data;
  }
  async capabilities({ refresh = false } = {}): Promise<Capabilities> {
    try {
      const data = await this.cached(
        "client/capabilities",
        {},
        60_000,
        refresh,
      );
      return {
        ...camel(data),
        runIdempotencyV1: data.run_idempotency_v1 === true,
      };
    } catch (error) {
      if (error instanceof NotFoundError) return { runIdempotencyV1: false };
      throw error;
    }
  }
  async run(options: CreateOptions & WaitOptions): Promise<Task> {
    const created = await this.tasks.create(options);
    return this.tasks.wait(created.taskUuid, options);
  }
}

class Models {
  constructor(private client: ModelHub) {}
  async list({
    skip = 0,
    limit = 20,
    search,
    taskType,
    tags,
    refresh = false,
  }: {
    skip?: number;
    limit?: number;
    search?: string;
    taskType?: string;
    tags?: string[];
    refresh?: boolean;
  } = {}): Promise<Page<Model>> {
    const data = await this.client.request("GET", "client/models", {
      params: {
        ...pageArgs(skip, limit),
        search,
        task_type: taskType,
        tags: tags?.join(","),
      },
    });
    return page(data, skip, limit, model);
  }
  async get(modelId: string, { refresh = false } = {}): Promise<Model> {
    safeId(modelId, true);
    return model(
      await this.client.request("GET", "client/models/detail", {
        params: { model_id: modelId },
      }),
    );
  }
  async schema(modelId: string, options = {}) {
    return convertSchema(await this.get(modelId, options));
  }
  async documentation(modelId: string, { language = "en" } = {}) {
    safeId(modelId, true);
    return camel(
      await this.client.request("GET", "client/models/documentation/lang", {
        params: { model_id: modelId, language, fallback: true },
      }),
    );
  }
}
class Pricing {
  constructor(private client: ModelHub) {}
  async get(modelId: string) {
    return camel(
      await this.client.request(
        "GET",
        "pricing/model-pricing/" + safeId(modelId, true),
      ),
    );
  }
  async preview({
    modelId,
    input,
    pricedAt,
  }: {
    modelId: string;
    input: JsonObject;
    pricedAt?: string;
  }): Promise<PricePreview> {
    safeId(modelId, true);
    const data = await this.client.request("POST", "pricing/preview", {
      body: { model_id: modelId, input_params: input, priced_at: pricedAt },
    });
    if (
      !["list_price", "discount_rate", "final_price", "you_save"].every(
        (k) => typeof data[k] === "number",
      )
    )
      throw new ProtocolError("Invalid price response");
    return {
      discountReason: null,
      pricingWindow: null,
      ...camel(data),
    } as unknown as PricePreview;
  }
}
class Tasks {
  constructor(private client: ModelHub) {}
  async create({
    modelId,
    input,
    webhookUrl,
    requestId = crypto.randomUUID(),
    signal,
  }: CreateOptions): Promise<TaskSubmission> {
    const path = "run/" + safeId(modelId, true);
    safeId(requestId);
    if (!object(input)) throw new Error("input must be a JSON object");
    const headers: Record<string, string> = { "X-Request-Id": requestId };
    const capabilities = await this.client.capabilities();
    const canRetry =
      capabilities.runIdempotencyV1 &&
      capabilities.idempotencyHeader === "X-Request-Id";
    signal?.throwIfAborted();
    try {
      return submission(
        await this.client.request("POST", path, {
          body: { input, webhook_url: webhookUrl ?? null },
          headers,
          retry: canRetry,
          signal,
        }),
      );
    } catch (error) {
      if (
        (error instanceof ModelHubError &&
          (error.statusCode === undefined ||
            error.statusCode >= 500 ||
            ["submission_unknown", "idempotency_in_progress"].includes(
              error.code,
            ))) ||
        signal?.aborted
      ) {
        const e =
          error instanceof ModelHubError
            ? error
            : new ModelHubError("Submission interrupted");
        throw new SubmissionUnknownError(
          "Submission may have succeeded. Recover the original operation; do not create a new one.",
          {
            statusCode: e.statusCode,
            code: "submission_unknown",
            requestId: e.requestId ?? requestId,
            details: e.details,
            candidateTaskUuid:
              object(e.details) && typeof e.details.task_uuid === "string"
                ? e.details.task_uuid
                : requestId,
          },
        );
      }
      throw error;
    }
  }
  async get(
    taskUuid: string,
    options: { signal?: AbortSignal; deadline?: number } = {},
  ): Promise<Task> {
    return task(
      await this.client.request(
        "GET",
        "run/tasks/" + safeId(taskUuid),
        options,
      ),
    );
  }
  async list({
    skip = 0,
    limit = 20,
    modelId,
    status,
  }: {
    skip?: number;
    limit?: number;
    modelId?: string;
    status?: string;
  } = {}): Promise<Page<Task>> {
    return page(
      await this.client.request("GET", "run/tasks", {
        params: { ...pageArgs(skip, limit), model_id: modelId, status },
      }),
      skip,
      limit,
      task,
    );
  }
  async wait(
    taskUuid: string,
    { timeoutMs = 600_000, signal }: WaitOptions = {},
  ): Promise<Task> {
    safeId(taskUuid);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("timeoutMs must be positive");
    const deadline = performance.now() + timeoutMs;
    let last: Task | undefined,
      delay = 2000;
    while (performance.now() < deadline) {
      signal?.throwIfAborted();
      try {
        last = await this.get(taskUuid, { signal, deadline });
      } catch (error) {
        if (performance.now() >= deadline && !signal?.aborted) break;
        throw error;
      }
      if (last.status === "completed") return last;
      if (last.status === "failed")
        throw new TaskFailedError(
          last.errorMessage ?? "Task failed",
          taskUuid,
          last,
        );
      if (last.status === "cancelled")
        throw new TaskCancelledError("Task cancelled", taskUuid, last);
      await sleep(
        Math.min(
          delay * (0.8 + Math.random() * 0.4),
          Math.max(0, deadline - performance.now()),
        ),
        signal,
      );
      delay = Math.min(5000, delay * 1.4);
    }
    throw new TaskWaitTimeoutError(
      "Task is still running; resume waiting with its ID",
      taskUuid,
      last,
    );
  }
}
