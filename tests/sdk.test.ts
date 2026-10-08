import { describe, it, expect } from "vitest";
import { AutoDataOps, IngestionResult, MemoryPatchCatalog } from "../src/index.js";

describe("AutoDataOps Pluggable SDK", () => {
  it("should process a clean payload matching the target contract immediately", async () => {
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

  it("should quarantine payload in 'git' / 'supervised' mode on unhealed drift", async () => {
    const ops = new AutoDataOps({ schema: "LogisticsShipment", reviewMode: "git" });
    const brokenPayload = {
      completely_unknown_key: "bad_data",
    };

    const res = await ops.process("broken_feed", brokenPayload);
    expect(res.driftDetected).toBe(true);
    expect(res.isQuarantined()).toBe(true);
    expect(res.data).toBeNull();
  });

  it("should allow custom ad-hoc field specifications", async () => {
    const customSpecs = {
      invoice_id: "str",
      amount: "float",
      paid: "bool",
    };

    const ops = new AutoDataOps({ fieldSpecs: customSpecs, schema: "BillingInvoice" });
    const validData = {
      invoice_id: "INV-100",
      amount: 450.75,
      paid: true,
    };

    const res = await ops.process("stripe_feed", validData);
    expect(res.status).toBe("SUCCESS");
    expect(res.data?.amount).toBe(450.75);
  });
});
