# AKOOL Model Hub TypeScript SDK

Package: `@akool/modelhub-sdk`. Node.js 22+, ESM, TypeScript declarations included.
Version 0.1.0 is prepared locally; the package has not yet been published.

After publication:

```bash
npm install @akool/modelhub-sdk
```

```typescript
import { ModelHub } from '@akool/modelhub-sdk';

const client = new ModelHub({
  apiKey: process.env.AKOOL_MODELHUB_API_KEY,
  baseUrl: 'https://maas.akool.com/api/v1',
});
const models = await client.models.list({ search: 'image', limit: 10 });
if (models.items.length) {
  console.log(await client.models.schema(models.items[0].modelId));
}
```

Options override `AKOOL_MODELHUB_API_KEY` and `AKOOL_MODELHUB_BASE_URL`. No CLI login
files are read. Keep keys in server-side applications, not browser bundles.
API roots retain gateway prefixes. Model discovery uses key-authorized `/client/models`
endpoints with no local model cache and no public-catalog fallback.

Inspect schemas before calling `pricing.preview({modelId, input})` and
`tasks.create({modelId, input, requestId})`. Save a unique request ID before submission.
For recovery reuse the same ID and identical input. `tasks.get(taskUuid)` queries once;
`tasks.wait(taskUuid, {timeoutMs, signal})` waits without cancelling the backend task.
`run({...createOptions, timeoutMs, signal})` submits and waits. Handle
`SubmissionUnknownError`, `TaskFailedError`, `TaskCancelledError` and
`TaskWaitTimeoutError` separately. Exact model input/output field names are preserved.
Media inputs require server-accessible HTTPS URLs; local files are not uploaded.

## Development and release

```bash
npm ci
npm test
npm pack
```

`npm pack` ships only compiled JavaScript, declarations and README, with no CLI or MCP.
Update the version using `npm version`, run tests, inspect the tarball, then publish using
`npm publish --access public` after confirming ownership of the `@akool` scope.
See `contracts/README.md` for backend-owned API contracts. This repository builds and
tests independently of Python, the CLI, MCP and backend checkouts.
