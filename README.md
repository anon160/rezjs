# AutoDataOps (Project Resilient)

> **Pure TypeScript AI-Native Data Resilience Library with WebAssembly Sandboxing & GitOps HITL**

AutoDataOps is an embeddable TypeScript library designed to eliminate API and webhook maintenance. When external partner feeds or webhooks drift (e.g. renamed fields, nested objects, type changes), AutoDataOps intercepts the break, uses a multi-provider **AI Agent (Vercel AI SDK)** to synthesize a repair patch, verifies it inside an isolated **WebAssembly QuickJS Sandbox**, authors an informative **Conventional Commit**, and opens a **Git Pull Request**.

**Git is the Patch Storage**: No custom databases, no standalone servers, no internal dashboards. Patch files are checked directly into your Git repository (`patches/`), reviewed via GitHub PRs, and deployed via your existing CI/CD.

---

## 🏛️ Architecture Overview

```text
       [ Host Application: Next.js / Express / Fastify / Lambda / Workers ]
                                  │
                                  ▼
                     [ ops = new AutoDataOps(...) ]
                                  │
                                  ▼
                   [ 1. Catalog Fast-Path Check ]
              (Applies existing active patch in <1ms)
                                  │
                       (No patch / New source)
                                  │
                                  ▼
                   [ 2. Zod Contract Validator ]
                 (Validates against target schema)
                 │                               │
           (Valid Clean)                (Schema Drift Detected)
                 │                               │
                 ▼                               ▼
        [ Clean Result ]               [ 3. Multi-Provider AI Agent ]
     (status="SUCCESS")            (Synthesizes & compiles patch)
                                                 │
                                                 ▼
                                     [ 4. WebAssembly Sandbox ]
                                  (QuickJS WASM isolate verification)
                                                 │
                                                 ▼
                                     [ 5. Git Review Engine ]
                                   (Authors Conventional Commit,
                                    creates `autodataops-patch/...`,
                                    exports `.ts` patch, opens PR)
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
          [ Mode: `autonomous` (Default) ]                  [ Mode: `git` / `supervised` ]
        - Deploys patch to local catalog                  - Quarantines payload (data=null)
        - Delivers clean data immediately                 - Returns status `PENDING_GIT_REVIEW`
        - Creates Git PR for audit trail                  - Caller routes to SQS/Kafka DLQ
```

---

## 🚀 Key Features

- **🔌 Embeddable Everywhere**: Pure TypeScript library. Drops into Next.js API routes, Express/Fastify backends, AWS Lambda, or Cloudflare Workers with sub-millisecond cold starts.
- **🛡️ Zod Contract Validation**: Validates incoming payloads against strict target schemas (e.g. `LogisticsShipment` or dynamic ad-hoc Zod specs).
- **🔒 True WebAssembly Sandboxing**: Executes candidate transformation patches inside a pure **QuickJS WebAssembly (WASM)** isolate. Zero filesystem access, zero network access, memory limits, and deadline execution timers.
- **🧠 Multi-Provider AI (Vercel AI SDK)**: Supports Google Gemini, OpenAI, Anthropic Claude, and local models via Ollama.
- **🐙 GitOps as Patch Storage**:
  - **No bespoke approval dashboards**: Review diffs natively in GitHub PRs or GitLab MRs.
  - **Conventional Commits**: Authors informative commits (`fix(pipeline): adapt vendor_feed to schema drift`).
  - **Automated Branches**: Provisions isolated review branches (`autodataops-patch/patch-{source}-v{version}`).
- **⚖️ Dual Review Governance**:
  - `reviewMode="autonomous"`: Zero-downtime hot-patching with Git PRs generated for auditability.
  - `reviewMode="git"` (or `"supervised"`): Strict enterprise change control where drifted records are marked `PENDING_GIT_REVIEW` until the Git PR is merged.
- **🗂️ Pluggable Patch Catalogs**:
  - `MemoryPatchCatalog`: Fast in-memory catalog (ideal for serverless / ephemeral / test pipelines).
  - `FilePatchCatalog`: GitOps-native filesystem catalog in `patches/` directory.

---

## 📦 Installation & Setup

```bash
git clone https://github.com/your-org/autodataops.git
cd autodataops
npm install
npm run build
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AUTODATAOPS_REVIEW_MODE` | `autonomous` | Review policy: `autonomous` (auto-apply + PR audit) or `git`/`supervised` (quarantine until PR merged). |
| `AUTODATAOPS_MODEL` | *(None)* | Model override (e.g. `google:gemini-2.5-flash`, `anthropic:claude-3-5-sonnet`, `openai:gpt-4o`, `ollama:qwen2.5-coder`). |
| `GEMINI_API_KEY` | *(None)* | Google Gemini API key for self-healing. |
| `OPENAI_API_KEY` | *(None)* | OpenAI API key (optional). |
| `ANTHROPIC_API_KEY` | *(None)* | Anthropic API key (optional). |
| `GITHUB_TOKEN` | *(None)* | Optional GitHub Personal Access Token to push branches and open remote PRs. |
| `GITHUB_REPOSITORY` | *(None)* | Target GitHub repo (`owner/repo`) for automated PR creation. |

---

## 💡 Quick Start & Usage Examples

### 1. Basic Ingestion & Drift Self-Healing

```typescript
import { AutoDataOps } from "autodataops";

// Initialize processor with target schema contract
const ops = new AutoDataOps({ schema: "LogisticsShipment", reviewMode: "autonomous" });

// Ingest raw payload (clean or drifted)
const rawRecord = {
  cntr: "CMA991122",
  carrier: "CMA CGM",
  state: "DELIVERED",
  from_port: "NLRTM",
  to_port: "SGSIN",
  gross_kg: "34500.0",
  eta: "2026-09-15"
};

const result = await ops.process("cma_stream", rawRecord);

if (result.isSuccess()) {
  console.log("Delivered clean data:", result.data);
  if (result.driftDetected) {
    console.log(`AI healed schema drift! Created Git branch: ${result.reviewBranch}`);
  }
} else if (result.isQuarantined()) {
  // In 'git' mode, route to Dead Letter Queue (SQS / Kafka DLQ)
  console.log(`Quarantined pending Git review: ${result.reviewBranch}`);
}
```

### 2. Custom Ad-Hoc Schemas

You can provide arbitrary target field specifications without pre-defining models:

```typescript
const customSpecs = {
  product_id: "int",
  product_name: "str",
  unit_price: "float",
  in_stock: "bool"
};

const ops = new AutoDataOps({ fieldSpecs: customSpecs, schema: "InventoryItem" });
const result = await ops.process("inventory_feed", rawData);
```

### 3. Using in a Webhook Handler (Next.js / Express / Cloudflare Workers)

```typescript
import { AutoDataOps } from "autodataops";

const ops = new AutoDataOps({ schema: "LogisticsShipment", reviewMode: "git" });

export async function POST(req: Request) {
  const rawPayload = await req.json();
  const sourceId = req.headers.get("x-vendor-id") || "vendor_stream";

  const result = await ops.process(sourceId, rawPayload);

  if (result.isSuccess()) {
    await db.shipments.insert(result.data);
    return Response.json({ status: "processed" });
  } else if (result.isQuarantined()) {
    await sqs.sendToDLQ(rawPayload);
    return Response.json({ status: "quarantined", reviewBranch: result.reviewBranch });
  }

  return Response.json({ status: "error", error: result.error }, { status: 500 });
}
```

---

## 🧪 Testing & Verification

Run the turnkey end-to-end library test:
```bash
npm run e2e
```

Run the unit test suites:
```bash
npm test
```

---

## 📄 License
Apache 2.0. Pure TypeScript open-source data resilience library.
