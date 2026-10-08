import * as fs from "node:fs";
import * as path from "node:path";

export interface BasePatchCatalog {
  getPatch(sourceId: string): string | null;
  savePatch(sourceId: string, patchCode: string): number;
  getPatchVersion(sourceId: string): number | null;
  clear(): void;
}

/**
 * High-speed in-memory patch catalog.
 * Ideal for testing, serverless functions, or ephemeral execution.
 */
export class MemoryPatchCatalog implements BasePatchCatalog {
  private patches = new Map<string, string>();
  private versions = new Map<string, number>();

  public getPatch(sourceId: string): string | null {
    return this.patches.get(sourceId) ?? null;
  }

  public savePatch(sourceId: string, patchCode: string): number {
    const currentVersion = this.versions.get(sourceId) ?? 0;
    const newVersion = currentVersion + 1;
    this.patches.set(sourceId, patchCode);
    this.versions.set(sourceId, newVersion);
    return newVersion;
  }

  public getPatchVersion(sourceId: string): number | null {
    return this.versions.get(sourceId) ?? null;
  }

  public clear(): void {
    this.patches.clear();
    this.versions.clear();
  }
}

/**
 * GitOps-native filesystem patch catalog.
 * Reads and writes versioned patch files (e.g. `patches/patch_<source>_v<version>.ts`).
 */
export class FilePatchCatalog implements BasePatchCatalog {
  private patchesDir: string;
  private memoryCache = new Map<string, { code: string; version: number }>();

  constructor(patchesDir?: string) {
    this.patchesDir = patchesDir ? path.resolve(patchesDir) : path.resolve(process.cwd(), "patches");
    fs.mkdirSync(this.patchesDir, { recursive: true });
    this.reloadFromDisk();
  }

  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  }

  public reloadFromDisk(): void {
    this.memoryCache.clear();
    if (!fs.existsSync(this.patchesDir)) return;

    const files = fs.readdirSync(this.patchesDir);
    const pattern = /^patch_(.+)_v(\d+)\.(ts|js)$/;

    for (const file of files) {
      const match = file.match(pattern);
      if (match) {
        const sourceId = match[1];
        const version = parseInt(match[2], 10);
        const fullPath = path.join(this.patchesDir, file);
        const code = fs.readFileSync(fullPath, "utf-8");

        const existing = this.memoryCache.get(sourceId);
        if (!existing || version > existing.version) {
          this.memoryCache.set(sourceId, { code, version });
        }
      }
    }
  }

  public getPatch(sourceId: string): string | null {
    const cleanId = this.sanitize(sourceId);
    return this.memoryCache.get(cleanId)?.code ?? null;
  }

  public savePatch(sourceId: string, patchCode: string): number {
    const cleanId = this.sanitize(sourceId);
    const currentVer = this.memoryCache.get(cleanId)?.version ?? 0;
    const newVer = currentVer + 1;

    const filename = `patch_${cleanId}_v${newVer}.ts`;
    const filepath = path.join(this.patchesDir, filename);

    fs.writeFileSync(filepath, patchCode, "utf-8");
    this.memoryCache.set(cleanId, { code: patchCode, version: newVer });
    return newVer;
  }

  public getPatchVersion(sourceId: string): number | null {
    const cleanId = this.sanitize(sourceId);
    return this.memoryCache.get(cleanId)?.version ?? null;
  }

  public clear(): void {
    this.memoryCache.clear();
    if (fs.existsSync(this.patchesDir)) {
      const files = fs.readdirSync(this.patchesDir);
      for (const file of files) {
        if (file.startsWith("patch_")) {
          fs.unlinkSync(path.join(this.patchesDir, file));
        }
      }
    }
  }
}
