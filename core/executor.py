import sys
import subprocess
import json
import base64
from typing import Dict, Any, Tuple, Optional
from core.schemas import validate_dynamic_payload, SCHEMA_TEMPLATES

DEFAULT_LOGISTICS_FIELDS = SCHEMA_TEMPLATES["Logistics & Supply Chain (LogisticsShipment)"]["fields"]

def execute_patch(
    patch_code: str,
    raw_payload: Dict[str, Any],
    field_specs: Optional[Dict[str, str]] = None,
    schema_name: str = "LogisticsShipment"
) -> Tuple[bool, Dict[str, Any] | None, str]:
    """Executes AI-generated transformation patch in an isolated subprocess with timeout.
    
    Validates output against user-defined dynamic JSON schema field specifications.
    Uses base64 encoding to safely pass payload data without code injection risks.
    """
    if not field_specs:
        field_specs = DEFAULT_LOGISTICS_FIELDS

    # Encode payload as base64 to prevent code injection via triple-quote escapes
    payload_json = json.dumps(raw_payload)
    b64_payload = base64.b64encode(payload_json.encode()).decode()

    # Build a self-contained runner script that executes the patch and prints JSON result
    runner_script = f"""{patch_code}

import json as _json
import base64 as _b64
_raw = _json.loads(_b64.b64decode('{b64_payload}').decode())
try:
    _result = transform(_raw)
    print("__PATCH_OK__" + _json.dumps(_result))
except Exception as _e:
    print("__PATCH_ERR__" + str(_e))
"""

    try:
        proc = subprocess.run(
            [sys.executable, "-c", runner_script],
            capture_output=True,
            text=True,
            timeout=5.0
        )

        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()

        if proc.returncode != 0:
            return False, None, f"Subprocess crashed (exit {proc.returncode}): {stderr or stdout}"

        if "__PATCH_OK__" in stdout:
            json_str = stdout.split("__PATCH_OK__", 1)[1].strip()
            transformed = json.loads(json_str)

            # Validate against dynamic Pydantic model constructed from field_specs
            is_valid, val_msg, valid_data = validate_dynamic_payload(transformed, field_specs, model_name=schema_name)
            if is_valid and valid_data is not None:
                return True, valid_data, f"Patch executed and passed {schema_name} validation."
            else:
                return False, transformed, f"Transformed output failed schema validation: {val_msg}"

        elif "__PATCH_ERR__" in stdout:
            err = stdout.split("__PATCH_ERR__", 1)[1].strip()
            return False, None, f"Patch runtime error: {err}"

        else:
            return False, None, f"Unexpected output: {stdout[:300]}"

    except subprocess.TimeoutExpired:
        return False, None, "Patch execution timed out (>5s)."
    except json.JSONDecodeError as e:
        return False, None, f"Patch returned invalid JSON: {e}"
    except Exception as e:
        return False, None, f"Validation error: {e}"
