import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import {
  exportPatchFile,
  generateSemanticCommitMessage,
  generatePrMarkdown,
  createGitReviewBranch,
} from "../src/git-review.js";

describe("GitOps Review Engine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should export patch files with standardized metadata header", () => {
    const patch = "function transform(raw) { return raw; }";
    const filePath = exportPatchFile(patch, "vendor_maersk", "LogisticsShipment", 1, tmpDir);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("AutoDataOps Self-Healing Schema Patch");
    expect(content).toContain("Source Feed:   vendor_maersk");
    expect(content).toContain("Patch Version: v1");
    expect(content).toContain("function transform(raw)");
  });

  it("should generate descriptive Conventional Commit messages", () => {
    const msg = generateSemanticCommitMessage("vendor_feed", "LogisticsShipment");
    expect(msg).toBe("fix(pipeline): adapt vendor_feed to LogisticsShipment schema drift");

    const custom = generateSemanticCommitMessage("feed", "Schema", "feat(feed): manual override");
    expect(custom).toBe("feat(feed): manual override");
  });

  it("should generate comprehensive PR markdown bodies", () => {
    const md = generatePrMarkdown("vendor_feed", "Shipment", "function transform(raw) { return raw; }", "Missing container_id");
    expect(md).toContain("AutoDataOps Autonomous Patch Review");
    expect(md).toContain("vendor_feed");
    expect(md).toContain("Missing container_id");
  });

  it("should provision review branch and author commit in a Git repository", async () => {
    // Initialize a temporary Git repo
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.name 'Test Runner'", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.email 'test@example.com'", { cwd: tmpDir, stdio: "pipe" });
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\n");
    execSync("git add README.md && git commit -m 'Initial commit'", { cwd: tmpDir, stdio: "pipe" });

    const result = await createGitReviewBranch({
      sourceId: "hapag_feed",
      schemaName: "LogisticsShipment",
      patchCode: "function transform(raw) { return raw; }",
      version: 1,
      repoDir: tmpDir,
    });

    expect(result.branchName).toBe("autodataops-patch/patch-hapag_feed-v1");
    const committedFiles = execSync(`git ls-tree -r --name-only ${result.branchName}`, { cwd: tmpDir, stdio: "pipe" })
      .toString()
      .trim();
    expect(committedFiles).toContain(path.basename(result.patchFile));
    expect(result.commitMessage).toContain("hapag_feed");

    // Verify branch was created
    const branches = execSync("git branch --list 'autodataops-patch/*'", { cwd: tmpDir, stdio: "pipe" })
      .toString()
      .trim();
    expect(branches).toContain("autodataops-patch/patch-hapag_feed-v1");
  });
});
