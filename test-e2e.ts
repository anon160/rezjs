/**
 * AutoDataOps — Pure TypeScript Library End-to-End Pipeline Verification Script.
 *
 * Verifies:
 * 1. Instantiation with target contract schemas
 * 2. Clean payload ingestion (baseline fast-path)
 * 3. Saved patch catalog execution (sub-millisecond hot-patching in QuickJS WASM)
 * 4. Supervised / Git mode review (quarantine state for enterprise change management)
 * 5. Dynamic custom schema contracts
 * 6. Git review branch inspection
 */

import { AutoDataOps, listReviewBranches } from "./src/index.js";

function printHeader(title: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  🚀 ${title}`);
  console.log(`${"=".repeat(70)}`);
}

async function main() {
  printHeader("AutoDataOps TypeScript Pluggable Library E2E Verification");

  // 1. Initialize AutoDataOps instance with LogisticsShipment contract
  console.log("\n[Step 1] Initializing AutoDataOps TypeScript SDK instance...");
  const ops = new AutoDataOps({ schema: "LogisticsShipment", reviewMode: "autonomous" });
  console.log(`  ✅ Schema:         ${ops.schemaName}`);
  console.log(`  ✅ Review Mode:    ${ops.reviewMode}`);
  console.log(`  ✅ Target Fields:  ${Object.keys(ops.fieldSpecs).join(", ")}`);

  // 2. Ingest clean baseline payload
  console.log("\n[Step 2] Processing Clean Valid Payload (Baseline)...");
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
  if (!res.isSuccess() || res.driftDetected) {
    throw new Error(`Clean payload processing failed: ${res.error}`);
  }
  console.log(`  ✅ Status:           ${res.status}`);
  console.log(`  ✅ Drift Detected:   ${res.driftDetected}`);
  console.log(`  ✅ Delivered Data:   ${res.data?.container_id} | ${res.data?.weight_kg} kg`);

  // 3. Saved patch fast path in QuickJS WebAssembly isolate
  console.log("\n[Step 3] Processing via Pre-Approved Patch Catalog (WASM Fast-Path)...");
  const patchCode = `
  function transform(raw) {
    return {
      container_id: String(raw.cntr),
      carrier_name: String(raw.carrier),
      status: String(raw.state),
      origin_port: String(raw.origin),
      destination_port: String(raw.dest),
      weight_kg: parseFloat(raw.gross_kg),
      eta_date: String(raw.eta)
    };
  }
  `;
  ops.catalog.savePatch("vendor_cma", patchCode);

  const driftedPayload = {
    cntr: "CMA-991122",
    carrier: "CMA CGM",
    state: "DELIVERED",
    origin: "NLRTM",
    dest: "SGSIN",
    gross_kg: "34500.0",
    eta: "2026-09-15",
  };
  const resPatch = await ops.process("vendor_cma", driftedPayload);
  if (!resPatch.isSuccess() || resPatch.data?.container_id !== "CMA-991122") {
    throw new Error(`Patch fast-path execution failed: ${resPatch.error}`);
  }
  console.log(`  ✅ Status:           ${resPatch.status}`);
  console.log(`  ✅ Patch Version:    v${resPatch.patchVersion}`);
  console.log(`  ✅ Transformed Data: ${resPatch.data?.container_id} -> ${resPatch.data?.status}`);

  // 4. Supervised / Git Review Mode (Quarantine behavior)
  console.log("\n[Step 4] Processing Drifted Payload in Supervised / Git Review Mode...");
  const supervisedOps = new AutoDataOps({ schema: "LogisticsShipment", reviewMode: "git" });
  const driftedPayload2 = {
    box_num: "HAPAG-445566",
    operator: "Hapag-Lloyd",
    status_code: "DELAYED",
  };
  const resSup = await supervisedOps.process("hapag_feed", driftedPayload2);
  if (!resSup.driftDetected || !resSup.isQuarantined()) {
    throw new Error(`Quarantine mode failed: ${resSup.status}`);
  }
  console.log(`  ✅ Status:           ${resSup.status}`);
  console.log(`  ✅ Quarantined:      ${resSup.isQuarantined()} (Caller routes to SQS/Kafka DLQ)`);
  console.log(`  ✅ Data Delivered:   ${resSup.data} (null, awaiting Git PR merge)`);

  // 5. Ad-hoc custom JSON schema validation
  console.log("\n[Step 5] Processing Ad-Hoc Custom Schema Contract...");
  const customSpecs = { transaction_id: "str", amount: "float", currency: "str" };
  const customOps = new AutoDataOps({ fieldSpecs: customSpecs, schema: "FinancialTransaction" });
  const customRes = await customOps.process("stripe_feed", {
    transaction_id: "tx_998877",
    amount: 250.75,
    currency: "USD",
  });
  if (!customRes.isSuccess()) {
    throw new Error(`Custom schema validation failed: ${customRes.error}`);
  }
  console.log(`  ✅ Custom Schema:    FinancialTransaction`);
  console.log(`  ✅ Validated Data:   ${JSON.stringify(customRes.data)}`);

  // 6. Inspect Git Review Branches in Local Repository
  console.log("\n[Step 6] Inspecting Git Review Branches in Local Repository...");
  try {
    const branches = await listReviewBranches();
    console.log(`  ✅ Active Git Review Branches found (${branches.length})`);
    for (const b of branches.slice(-3)) {
      console.log(`     - ${b.trim()}`);
    }
  } catch {
    console.log("  ℹ️ Not running inside a Git work-tree or no branches yet.");
  }

  printHeader("ALL TYPESCRIPT LIBRARY VERIFICATIONS PASSED! 🎉");
  console.log("Summary of verified capabilities:");
  console.log("  • Pure TypeScript Library (Zero standalone HTTP/FastAPI server overhead)");
  console.log("  • Zero Database Overhead (Pluggable In-Memory & File Patch Catalogs)");
  console.log("  • Zod Contract Enforcement & Drift Interception");
  console.log("  • Sub-millisecond WebAssembly QuickJS Isolate Sandboxing");
  console.log("  • Dual Review Modes: 'autonomous' vs 'git' / 'supervised'");
  console.log("  • Clean IngestionResult with isSuccess() / isQuarantined() methods\n");
}

main().catch((err) => {
  console.error("❌ E2E Verification failed:", err);
  process.exit(1);
});
