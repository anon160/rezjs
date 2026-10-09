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

describe("AutoDataOps Pluggable SDK with Mandatory Git & User Contracts", () => {
  it("should fail fast if running outside a Git repository", async () => {
    // Create an empty temporary directory without git init
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

    // Ingest clean payload matching user contract
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

  it("should process a clean payload matching the default contract immediately", async () => {
    const ops = new AutoDataOps({ schema: "LogisticsShipment" });
    const cleanPayload = {
      container_id: "MSKU1234567",
      carrier_name: "Maersk Line",
      status: "IN_TRANSIT",
      origin_port: "CNSHA",
      destination_port: "USLAX",
      weight_kg: 24500.5,
      eta_date: "2026-09-10",
    };

    const res = await ops.process("clean_maersk_feed", cleanPayload);
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
        status: String(raw.state),
        origin_port: String(raw.from_port),
        destination_port: String(raw.to_port),
        weight_kg: parseFloat(raw.gross_kg),
        eta_date: String(raw.eta)
      };
    }
    `;
    catalog.savePatch("cma_feed", patchCode);

    const ops = new AutoDataOps({ schema: "LogisticsShipment", catalog });
    const driftedPayload = {
      cntr: "CMA999",
      carrier: "CMA CGM",
      state: "DELIVERED",
      from_port: "NLRTM",
      to_port: "SGSIN",
      gross_kg: "32000.0",
      eta: "2026-09-15",
    };

    const res = await ops.process("cma_feed", driftedPayload);
    expect(res.status).toBe("SUCCESS");
    expect(res.driftDetected).toBe(false);
    expect(res.isSuccess()).toBe(true);
    expect(res.patchVersion).toBe(1);
    expect(res.data?.container_id).toBe("CMA999");
    expect(res.data?.weight_kg).toBe(32000.0);
  });

  it("should quarantine payload and intercept drift", async () => {
    const ops = new AutoDataOps({ schema: "LogisticsShipment" });
    const brokenPayload = {
      completely_unknown_key: "bad_data",
    };

    const res = await ops.process("broken_feed", brokenPayload);
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

  it("should support top-level resilient singleton export", async () => {
    expect(resilient).toBeDefined();
    expect(typeof resilient.ingest).toBe("function");
  });
});
