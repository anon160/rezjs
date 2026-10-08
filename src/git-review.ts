import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

export interface GitReviewResult {
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  patchFile: string;
  remotePrUrl?: string | null;
}

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase().replace(/^_+|_+$/g, "");
}

/**
 * Exports verified patch code to patches/ directory.
 */
export function exportPatchFile(
  patchCode: string,
  sourceId: string,
  schemaName: string = "DynamicSchema",
  version: number = 1,
  baseDir?: string
): string {
  const root = baseDir ? path.resolve(baseDir) : process.cwd();
  const patchesDir = path.join(root, "patches");
  fs.mkdirSync(patchesDir, { recursive: true });

  const cleanSource = sanitizeName(sourceId);
  const cleanSchema = sanitizeName(schemaName);
  const filename = `${cleanSchema}_${cleanSource}_v${version}.ts`;
  const filepath = path.join(patchesDir, filename);

  const timestamp = new Date().toISOString();
  const header = `/**
 * AutoDataOps Self-Healing Schema Patch
 * Source Feed:   ${sourceId}
 * Target Schema: ${schemaName}
 * Patch Version: v${version}
 * Generated At:  ${timestamp}
 * Verification:  PASSED (WebAssembly QuickJS isolate sandbox)
 * Review Status: PENDING ENTERPRISE GIT REVIEW
 */

`;

  const fullContent = header + patchCode.trim() + "\n";
  fs.writeFileSync(filepath, fullContent, "utf-8");
  return filepath;
}

export function isGitRepository(repoDir?: string): boolean {
  const cwd = repoDir ? path.resolve(repoDir) : process.cwd();
  try {
    const res = execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    return res.toString().trim() === "true";
  } catch {
    return false;
  }
}

export function generateSemanticCommitMessage(
  sourceId: string,
  schemaName: string,
  customMsg?: string
): string {
  if (customMsg && customMsg.trim()) return customMsg.trim();
  const cleanSource = sanitizeName(sourceId);
  return `fix(pipeline): adapt ${cleanSource} to ${schemaName} schema drift`;
}

export function generatePrMarkdown(
  sourceId: string,
  schemaName: string,
  patchCode: string,
  validationError?: string,
  customBody?: string
): string {
  if (customBody && customBody.trim()) return customBody.trim();

  return `## 🤖 AutoDataOps Autonomous Patch Review

### Incident Overview
- **Source Identifier:** \`${sourceId}\`
- **Target Contract Schema:** \`${schemaName}\`
- **Status:** Verified in WebAssembly QuickJS isolate sandbox.

### Detected Schema Drift
\`\`\`text
${validationError || "Schema contract validation failure intercepted on live payload."}
\`\`\`

### Proposed Transformation Patch
\`\`\`typescript
${patchCode}
\`\`\`

### Review Instructions
1. Review the proposed transformation mapping above.
2. Verify that unit conversions and field mappings align with business expectations.
3. Merge this Pull Request to approve and deploy the patch to production.
`;
}

export async function createGitReviewBranch(options: {
  sourceId: string;
  schemaName?: string;
  patchCode: string;
  version?: number;
  repoDir?: string;
  pushRemote?: boolean;
  validationError?: string;
  customCommitMsg?: string;
  customPrTitle?: string;
  customPrBody?: string;
}): Promise<GitReviewResult> {
  const {
    sourceId,
    schemaName = "DynamicSchema",
    patchCode,
    version = 1,
    repoDir,
    pushRemote = false,
    validationError,
    customCommitMsg,
    customPrTitle,
    customPrBody,
  } = options;

  const cwd = repoDir ? path.resolve(repoDir) : process.cwd();
  const cleanSource = sanitizeName(sourceId);
  const branchName = `autodataops-patch/patch-${cleanSource}-v${version}`;

  // 1. Export patch file to patches/
  const patchFilePath = exportPatchFile(patchCode, sourceId, schemaName, version, cwd);

  const commitMessage = generateSemanticCommitMessage(sourceId, schemaName, customCommitMsg);
  const prTitle = customPrTitle || `fix(${cleanSource}): adapt schema to ${schemaName} contract`;
  const prBody = generatePrMarkdown(sourceId, schemaName, patchCode, validationError, customPrBody);

  let remotePrUrl: string | null = null;

  // 2. Provision local Git branch and commit if inside a Git repository
  if (isGitRepository(cwd)) {
    try {
      // Check current branch
      const originalBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: "pipe" })
        .toString()
        .trim();

      // Check if review branch already exists
      const branchExists = execSync(`git branch --list "${branchName}"`, { cwd, stdio: "pipe" })
        .toString()
        .trim().length > 0;

      if (branchExists) {
        execSync(`git checkout "${branchName}"`, { cwd, stdio: "pipe" });
      } else {
        execSync(`git checkout -b "${branchName}"`, { cwd, stdio: "pipe" });
      }

      // Stage patch file
      const relPatchPath = path.relative(cwd, patchFilePath);
      execSync(`git add "${relPatchPath}"`, { cwd, stdio: "pipe" });

      // Commit
      const escapedMsg = commitMessage.replace(/"/g, '\\"');
      execSync(`git commit -m "${escapedMsg}"`, { cwd, stdio: "pipe" });

      // Switch back to original branch so current working tree stays undisturbed
      if (originalBranch && originalBranch !== branchName) {
        execSync(`git checkout "${originalBranch}"`, { cwd, stdio: "pipe" });
      }

      // Optional remote push & PR creation via Octokit
      if (pushRemote) {
        const token = process.env.GITHUB_TOKEN;
        const repoSlug = process.env.GITHUB_REPOSITORY; // "owner/repo"

        if (token && repoSlug && repoSlug.includes("/")) {
          execSync(`git push origin "${branchName}"`, { cwd, stdio: "pipe" });

          const [owner, repo] = repoSlug.split("/");
          const octokit = new Octokit({ auth: token });
          const pr = await octokit.rest.pulls.create({
            owner,
            repo,
            title: prTitle,
            head: branchName,
            base: "main",
            body: prBody,
          });
          remotePrUrl = pr.data.html_url;
        }
      }
    } catch (err: any) {
      console.warn(`[GitReview] Warning while running git operations: ${err?.message || err}`);
    }
  }

  return {
    branchName,
    commitMessage,
    prTitle,
    prBody,
    patchFile: patchFilePath,
    remotePrUrl,
  };
}
