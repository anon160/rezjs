import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemoryPatchCatalog, FilePatchCatalog } from "../src/catalog.js";

describe("Patch Catalogs", () => {
  it("MemoryPatchCatalog should store and retrieve patches with version increments", () => {
    const catalog = new MemoryPatchCatalog();
    expect(catalog.getPatch("vendor_a")).toBeNull();

    const v1 = catalog.savePatch("vendor_a", "function transform(raw) { return raw; }");
    expect(v1).toBe(1);
    expect(catalog.getPatch("vendor_a")).toBe("function transform(raw) { return raw; }");
    expect(catalog.getPatchVersion("vendor_a")).toBe(1);

    const v2 = catalog.savePatch("vendor_a", "function transform(raw) { return { a: 1 }; }");
    expect(v2).toBe(2);
    expect(catalog.getPatchVersion("vendor_a")).toBe(2);

    catalog.clear();
    expect(catalog.getPatch("vendor_a")).toBeNull();
  });

  describe("FilePatchCatalog", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autodataops-test-"));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should write and reload patch files from disk", () => {
      const catalog = new FilePatchCatalog(tmpDir);
      const patchCode = "function transform(raw) { return { patched: true }; }";

      const v1 = catalog.savePatch("feed_x", patchCode);
      expect(v1).toBe(1);

      const expectedFile = path.join(tmpDir, "patch_feed_x_v1.ts");
      expect(fs.existsSync(expectedFile)).toBe(true);

      // Verify a new catalog instance pointing to the same folder reloads from disk
      const reloadedCatalog = new FilePatchCatalog(tmpDir);
      expect(reloadedCatalog.getPatch("feed_x")).toBe(patchCode);
      expect(reloadedCatalog.getPatchVersion("feed_x")).toBe(1);
    });
  });
});
