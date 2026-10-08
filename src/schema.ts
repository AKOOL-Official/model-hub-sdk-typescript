export type JsonObject = Record<string, unknown>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function convertSchema(model: {
  modelId: string;
  parameters: JsonObject[];
  outputSchema?: JsonObject | null;
  requestId?: string | null;
}) {
  const warnings: string[] = [];
  function objectSchema(parameters: JsonObject[]): JsonObject {
    const properties: Record<string, JsonObject> = Object.create(null);
    const required: string[] = [];
    for (const p of parameters) {
      const key = p.key,
        kind = p.type;
      if (typeof key !== "string") {
        warnings.push("Parameter without a key was omitted");
        continue;
      }
      let out: JsonObject = {};
      if (kind === "text" || kind === "textarea") {
        out = { type: "string" };
        if (p.max_length != null) out.maxLength = p.max_length;
      } else if (kind === "number" || kind === "slider") {
        out = { type: "number" };
        if (p.min != null) out.minimum = p.min;
        if (p.max != null) out.maximum = p.max;
      } else if (kind === "boolean") out = { type: "boolean" };
      else if (
        kind === "select" &&
        Array.isArray(p.options) &&
        p.options.length
      )
        out = { enum: p.options.map((option) => (option as JsonObject).value) };
      else if (typeof kind === "string" && kind.endsWith("_upload"))
        out = { type: "string", format: "uri" };
      else if (typeof kind === "string" && kind.endsWith("_upload_group"))
        out = { type: "array", items: { type: "string", format: "uri" } };
      else if (kind === "object")
        out = objectSchema((p.object_properties ?? []) as JsonObject[]);
      else if (kind === "array")
        out = {
          type: "array",
          items:
            p.items_type === "object"
              ? objectSchema((p.object_properties ?? []) as JsonObject[])
              : ["string", "number"].includes(String(p.items_type))
                ? { type: p.items_type }
                : {},
        };
      else {
        out = { "x-model-hub-parameter": p };
        warnings.push(`Unsupported parameter type for ${key}: ${kind}`);
      }
      if (out.type === "array") {
        if (p.min_count != null) out.minItems = p.min_count;
        if (p.max_count != null) out.maxItems = p.max_count;
      }
      for (const field of ["default", "description"]) {
        let value = p[field];
        if (
          field === "description" &&
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          value = (value as JsonObject).en ?? (value as JsonObject).zh;
        }
        if (value != null) out[field] = value;
      }
      if (p.example != null) out.examples = [p.example];
      if (p.show_if) {
        out["x-model-hub-show-if"] = p.show_if;
        warnings.push(
          `Conditional visibility for ${key} is a hint, not a required constraint`,
        );
      } else if (p.required) required.push(key);
      properties[key] = out;
    }
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(properties)),
      additionalProperties: true,
      ...(required.length ? { required } : {}),
    };
  }
  const inputSchema = objectSchema(model.parameters);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(inputSchema)),
  );
  return {
    modelId: model.modelId,
    inputSchema,
    outputSchema: model.outputSchema ?? null,
    warnings,
    schemaHash: Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    requestId: model.requestId ?? null,
  };
}
