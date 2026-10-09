import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  AutoDataOps,
  resilient,
  defineConfig,
  IngestionResult,
  MemoryPatchCatalog,
} from "../src/index.js";

describe("AutoDataOps / Resilient SDK with Mandatory Git & User Contracts", () => {
  it("should fail fast if running outside a Git repository", async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
    try {
      const ops = new AutoDataOps({ repoDir: nonGitDir });
      await expect(
        ops.ingest({
          source: "test_feed",
          payload: { foo: "bar" },
        })
      ).rejects.toThrow(/Git repository is mandatory/i);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("should support defineConfig and user-defined Zod contracts", async () => {
    const config = defineConfig({
      model: {
        provider: "google",
        name: "gemini-2.5-flash",
      },
      git: {
        baseBranch: "main",
      },
      contracts: {
        CustomerOrder: z.object({
          order_id: z.string(),
          total_usd: z.number().positive(),
          status: z.enum(["PENDING", "COMPLETED"]),
        }),
      },
    });

    const ops = new AutoDataOps({ config });

    const cleanPayload = {
      order_id: "ord_8822",
      total_usd: 129.5,
      status: "COMPLETED",
    };

    const res = await ops.ingest({
      source: "shopify_feed",
      schema: "CustomerOrder",
      payload: cleanPayload,
    });

    expect(res.isSuccess()).toBe(true);
    expect(res.data?.order_id).toBe("ord_8822");
    expect(res.data?.total_usd).toBe(129.5);
  });

  it("should process a clean payload matching a registered contract immediately", async () => {
    const ShipmentContract = z.object({
      container_id: z.string(),
      carrier_name: z.string(),
      weight_kg: z.number(),
    });

    const ops = new AutoDataOps({ contract: ShipmentContract });
    const cleanPayload = {
      container_id: "MSKU1234567",
      carrier_name: "Maersk Line",
      weight_kg: 24500.5,
    };

    const res = await ops.ingest({
      source: "clean_maersk_feed",
      payload: cleanPayload,
    });

    expect(res).toBeInstanceOf(IngestionResult);
    expect(res.status).toBe("SUCCESS");
    expect(res.driftDetected).toBe(false);
    expect(res.isSuccess()).toBe(true);
    expect(res.isQuarantined()).toBe(false);
    expect(res.data?.container_id).toBe("MSKU1234567");
    expect(res.data?.weight_kg).toBe(24500.5);
  });

  it("should execute an approved patch from the catalog on fast-path (<1ms)", async () => {
    const catalog = new MemoryPatchCatalog();
    const patchCode = `
    function transform(raw) {
      return {
        container_id: String(raw.cntr),
        carrier_name: String(raw.carrier),
        weight_kg: parseFloat(raw.gross_kg)
      };
    }
    `;
    catalog.savePatch("cma_feed", patchCode);

    const ShipmentSchema = z.object({
      container_id: z.string(),
      carrier_name: z.string(),
      weight_kg: z.number(),
    });

    const ops = new AutoDataOps({ contract: ShipmentSchema, catalog });
    const driftedPayload = {
      cntr: "CMA999",
      carrier: "CMA CGM",
      gross_kg: "32000.0",
    };

    const res = await ops.ingest({
      source: "cma_feed",
      payload: driftedPayload,
    });

    expect(res.status).toBe("SUCCESS");
    expect(res.driftDetected).toBe(false);
    expect(res.isSuccess()).toBe(true);
    expect(res.patchVersion).toBe(1);
    expect(res.data?.container_id).toBe("CMA999");
    expect(res.data?.weight_kg).toBe(32000.0);
  });

  it("should quarantine payload and intercept drift", async () => {
    const SimpleContract = z.object({
      valid_key: z.string(),
    });

    const ops = new AutoDataOps({ contract: SimpleContract });
    const brokenPayload = {
      completely_unknown_key: "bad_data",
    };

    const res = await ops.ingest({
      source: "broken_feed",
      payload: brokenPayload,
    });

    expect(res.driftDetected).toBe(true);
    expect(res.isQuarantined()).toBe(true);
    expect(res.data).toBeNull();
  });

  it("should allow registering contracts dynamically via registerContract", async () => {
    const ops = new AutoDataOps();
    ops.registerContract("Invoice", {
      invoice_id: "str",
      amount: "float",
      paid: "bool",
    });

    const validData = {
      invoice_id: "INV-100",
      amount: 450.75,
      paid: true,
    };

    const res = await ops.ingest({
      source: "stripe_feed",
      schema: "Invoice",
      payload: validData,
    });

    expect(res.status).toBe("SUCCESS");
    expect(res.data?.amount).toBe(450.75);
  });

  it("should throw if requested contract is not registered", async () => {
    const ops = new AutoDataOps();
    await expect(
      ops.ingest({
        source: "unknown_feed",
        schema: "NonExistentContract",
        payload: { a: 1 },
      })
    ).rejects.toThrow(/Contract "NonExistentContract" is not registered/i);
  });

  it("should support top-level resilient singleton export", async () => {
    expect(resilient).toBeDefined();
    expect(typeof resilient.ingest).toBe("function");
  });
});
