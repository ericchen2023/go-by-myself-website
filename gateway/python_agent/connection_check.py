"""Read-only robot identity and control-plane connectivity preflight.

This command never fetches or acknowledges commands and never invokes a
hardware adapter. It is safe to run before any physical capability is enabled.
"""

from __future__ import annotations

import json
import os
import urllib.error
from typing import Any

from agent import ControlPlane, ControlPlaneResponseError, ControlPlaneScopeError


REQUIRED_ENV = (
    "CONTROL_PLANE_URL",
    "ROBOT_VEHICLE_ID",
    "ROBOT_CLIENT_ID",
    "ROBOT_CLIENT_TOKEN",
)
PUBLIC_ERROR_CODES = {
    "ROBOT_IDENTITY_INVALID",
    "ROBOT_SCOPE_DENIED",
    "RATE_LIMITED",
    "ENV_CONFIG_INVALID",
}


def safe_summary(vehicle_id: str, state: dict[str, Any] | None) -> dict[str, Any]:
    scope_matched = state is None or (isinstance(state, dict) and state.get("vehicle_id") == vehicle_id)
    return {
        "ok": True,
        "authenticated": True,
        "vehicleScopeMatched": scope_matched,
        "vehicleId": vehicle_id,
        "vehicleState": state.get("vehicle_state") if isinstance(state, dict) else None,
        "connectivity": state.get("connectivity") if isinstance(state, dict) else None,
    }


def failure_summary(error: BaseException) -> dict[str, Any]:
    code = "CONTROL_PLANE_UNREACHABLE"
    status = None
    if isinstance(error, ControlPlaneResponseError):
        code = "CONTROL_PLANE_RESPONSE_INVALID"
    elif isinstance(error, ControlPlaneScopeError):
        code = "ROBOT_SCOPE_DENIED"
    elif isinstance(error, urllib.error.HTTPError):
        status = error.code
        try:
            body = json.loads(error.read().decode("utf-8"))
            candidate = body.get("error", {}).get("code")
            if candidate in PUBLIC_ERROR_CODES:
                code = candidate
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    return {"ok": False, "authenticated": False, "httpStatus": status, "errorCode": code}


def main() -> None:
    values = {name: os.environ.get(name, "").strip() for name in REQUIRED_ENV}
    missing = [name for name, value in values.items() if not value]
    if missing:
        print(json.dumps({"ok": False, "errorCode": "ENV_CONFIG_INVALID", "missing": missing}))
        raise SystemExit(2)

    control_plane = ControlPlane(
        values["CONTROL_PLANE_URL"],
        values["ROBOT_VEHICLE_ID"],
        values["ROBOT_CLIENT_ID"],
        values["ROBOT_CLIENT_TOKEN"],
    )
    try:
        result = safe_summary(values["ROBOT_VEHICLE_ID"], control_plane.verify_identity_scope())
    except (ControlPlaneResponseError, ControlPlaneScopeError, urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        print(json.dumps(failure_summary(error)))
        raise SystemExit(1) from None

    print(json.dumps(result))
    if not result["vehicleScopeMatched"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
