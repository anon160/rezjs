import { getQuickJS, shouldInterruptAfterDeadline, QuickJSWASMModule } from "quickjs-emscripten";
import { z } from "zod";
import { validatePayload } from "./contracts.js";

let quickJsPromise: Promise<QuickJSWASMModule> | null = null;

function getQuickJsInstance(): Promise<QuickJSWASMModule> {
  if (!quickJsPromise) {
    quickJsPromise = getQuickJS();
  }
  return quickJsPromise;
}

/**
 * Cleans up patch code by removing markdown fences and export keywords.
 */
export function cleanPatchCode(patchCode: string): string {
  let cleaned = patchCode.trim();

  // Strip markdown fences
  if (cleaned.startsWith("```javascript") || cleaned.startsWith("```typescript") || cleaned.startsWith("```js") || cleaned.startsWith("```ts")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\n?/, "");
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  // Strip top-level export keywords so it evaluates cleanly in script scope
  cleaned = cleaned.replace(/^export\s+(default\s+)?/gm, "");

  return cleaned.trim();
}

export interface ExecutePatchResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Executes an AI-generated transform() patch function inside a pure WebAssembly
 * QuickJS isolate with memory limits and execution deadlines.
 *
 * Guarantees zero filesystem, network, or environment variable access.
 */
export async function executePatch<T = any>(
  patchCode: string,
  rawPayload: Record<string, any>,
  schemaOrSpecs?: z.ZodTypeAny | Record<string, string>,
  timeoutMs: number = 2000
): Promise<ExecutePatchResult<T>> {
  const QuickJS = await getQuickJsInstance();
  const vm = QuickJS.newContext();

  try {
    // Enforce deadline interrupt (CPU execution timeout)
    const deadline = Date.now() + timeoutMs;
    vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

    // Optional memory limit: 8MB
    vm.runtime.setMemoryLimit(1024 * 1024 * 8);

    const cleanedCode = cleanPatchCode(patchCode);

    // Build runner harness
    const serializedPayload = JSON.stringify(rawPayload);
    const runnerScript = `
${cleanedCode}

if (typeof transform !== 'function') {
  throw new Error("Patch must define a 'transform(raw)' function.");
}

const _rawPayload = ${serializedPayload};
const _transformed = transform(_rawPayload);
JSON.stringify(_transformed);
`;

    const evalResult = vm.evalCode(runnerScript);

    if (evalResult.error) {
      const errorObj = vm.dump(evalResult.error);
      evalResult.error.dispose();
      const errMsg = typeof errorObj === "object" && errorObj !== null ? (errorObj.message || String(errorObj)) : String(errorObj);
      return {
        success: false,
        error: `Sandbox runtime error: ${errMsg}`,
      };
    }

    const outputJsonStr = vm.dump(evalResult.value);
    evalResult.value.dispose();

    if (typeof outputJsonStr !== "string") {
      return {
        success: false,
        error: "Transform function did not return a valid serializable object.",
      };
    }

    const transformedData = JSON.parse(outputJsonStr);

    // Validate transformed output against target schema if provided
    if (schemaOrSpecs) {
      const validation = validatePayload<T>(transformedData, schemaOrSpecs);
      if (!validation.isValid) {
        return {
          success: false,
          data: transformedData,
          error: `Transformed output failed schema contract validation: ${validation.error}`,
        };
      }
      return {
        success: true,
        data: validation.data,
      };
    }

    return {
      success: true,
      data: transformedData as T,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Sandbox execution exception: ${err?.message || String(err)}`,
    };
  } finally {
    vm.dispose();
  }
}
