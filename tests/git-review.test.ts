import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { simpleGit } from "simple-git";
import {
  exportPatchFile,
  generateSemanticCommitMessage,
  generatePrMarkdown,
  createGitReviewBranch,
  isGitRepository,
  listReviewBranches,
} from "../src/git-review.js";

describe("GitOps Review Engine with simple-git", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should accurately detect non-git directory", async () => {
    const isRepo = await isGitRepository(tmpDir);
    expect(isRepo).toBe(false);
  });

  it("should export patch files with standardized metadata header", () => {
    const patch = "function transform(raw) { return raw; }";
    const filePath = exportPatchFile(patch, "vendor_maersk", "LogisticsShipment", 1, tmpDir);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("Rez (rezjs) Self-Healing Schema Patch");
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
    expect(md).toContain("Rez Autonomous Patch Review");
    expect(md).toContain("vendor_feed");
    expect(md).toContain("Missing container_id");
  });

  it("should provision review branch and author commit using simple-git in repository", async () => {
    // Initialize a temporary Git repo using simpleGit
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig("user.name", "Test Runner");
    await git.addConfig("user.email", "test@example.com");

    const isRepo = await isGitRepository(tmpDir);
    expect(isRepo).toBe(true);

    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\n");
    await git.add("README.md");
    await git.commit("Initial commit");

    const result = await createGitReviewBranch({
      sourceId: "hapag_feed",
      schemaName: "LogisticsShipment",
      patchCode: "function transform(raw) { return raw; }",
      version: 1,
      repoDir: tmpDir,
    });

    expect(result.branchName).toBe("rez-patch/patch-hapag_feed-v1");
    expect(result.commitMessage).toContain("hapag_feed");

    // Verify branch was created and is listed
    const reviewBranches = await listReviewBranches(tmpDir);
    expect(reviewBranches).toContain("rez-patch/patch-hapag_feed-v1");

    // Verify commit tree has the patch file
    const log = await git.log({ from: "HEAD", to: result.branchName });
    expect(log.latest?.message).toContain("hapag_feed");
  });
});
