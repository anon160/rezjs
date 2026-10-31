import { defineConfig } from "./src/index.js";
import { z } from "zod";

export default defineConfig({
  // 1. Model & Provider Configuration
  model: {
    model: process.env.REZ_MODEL || process.env.AUTODATAOPS_MODEL || "google:gemini-2.5-flash",
    fallback: "openrouter:meta-llama/llama-3.3-70b-instruct",
  },

  // 2. Mandatory Git Ledger Configuration
  git: {
    baseBranch: "main",
    patchDir: "patches",
    autoPush: false,
    createPullRequest: true,
  },

  // 3. User-Defined Schema Contracts
  contracts: {
    LogisticsShipment: z.object({
      container_id: z.string(),
      carrier_name: z.string(),
      status: z.enum(["IN_TRANSIT", "DELIVERED", "DELAYED", "EXCEPTION"]),
      origin_port: z.string(),
      destination_port: z.string(),
      weight_kg: z.number().positive(),
      eta_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),

    FinancialTransaction: z.object({
      transaction_id: z.string(),
      amount: z.number(),
      currency: z.string(),
    }),
  },
});
