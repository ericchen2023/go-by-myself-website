"""Contract-v2 validation shared by the Jetson Python agent.

The website repository owns the JSON schemas and fixtures. This module keeps a
small fail-closed semantic layer for environments where adding a ROS dependency
must not change the public command envelope.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

CONTRACT_VERSION = 2
_CONTRACTS = Path(__file__).parents[2] / "contracts"
# Read the pinned graph rather than restating it: a copy here would drift from
# the file the vehicle vendors, and the two disagreeing is not detectable from
# either side alone.
ROUTE_GRAPH = json.loads((_CONTRACTS / "route-graph.v5.json").read_text(encoding="utf-8"))
ROUTE_VERSION = ROUTE_GRAPH["version"]
ROUTE_CHECKSUM = ROUTE_GRAPH["checksum"]
VEHICLE_STATES = {
    "idle", "preparing", "localizing", "moving", "at_stop",
    "safe_stopped", "returning_to_base", "fault",
}
COMMAND_TYPES = {"DISPATCH", "OPEN_COMPARTMENT", "CANCEL", "RETURN_TO_BASE"}
PHYSICAL_MANIFEST = json.loads(
    (_CONTRACTS / "physical-route-manifest.v1.json").read_text(encoding="utf-8")
)
if PHYSICAL_MANIFEST["routeGraphVersion"] != ROUTE_VERSION \
        or PHYSICAL_MANIFEST["routeGraphChecksum"] != ROUTE_CHECKSUM:
    raise RuntimeError("physical route manifest is pinned to a different route graph")


class ContractError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str):
        raise ContractError("COMMAND_SCHEMA_INVALID", f"{field} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractError("COMMAND_SCHEMA_INVALID", f"{field} is invalid") from error
    if parsed.tzinfo is None:
        raise ContractError("COMMAND_SCHEMA_INVALID", f"{field} must include a timezone")
    return parsed


def validate_command(command: Any, vehicle_id: str, now: datetime | None = None) -> dict[str, Any]:
    if not isinstance(command, dict):
        raise ContractError("COMMAND_SCHEMA_INVALID", "command must be an object")
    if command.get("schemaVersion") != CONTRACT_VERSION:
        raise ContractError("COMMAND_VERSION_UNSUPPORTED", "unknown command major version")
    required = {"commandId", "correlationId", "idempotencyKey", "vehicleId", "target", "type", "issuedAt", "expiresAt", "payload"}
    if required - command.keys():
        raise ContractError("COMMAND_SCHEMA_INVALID", "required command field is missing")
    if command["vehicleId"] != vehicle_id:
        raise ContractError("COMMAND_VEHICLE_MISMATCH", "command belongs to another vehicle")
    if command["type"] not in COMMAND_TYPES:
        raise ContractError("COMMAND_TYPE_UNSUPPORTED", "unsupported command type")
    target = command.get("target")
    if not isinstance(target, dict) or target.get("kind") not in {"delivery", "route_job"} or not target.get("id"):
        raise ContractError("COMMAND_SCHEMA_INVALID", "target is invalid")
    expires_at = _timestamp(command["expiresAt"], "expiresAt")
    if expires_at <= (now or datetime.now(timezone.utc)):
        raise ContractError("COMMAND_EXPIRED", "late command rejected")
    if command["type"] == "CANCEL" and "preconditions" in command:
        raise ContractError("COMMAND_SCHEMA_INVALID", "CANCEL must not depend on a racing vehicle state")
    if command["type"] == "DISPATCH":
        preconditions = command.get("preconditions", {}).get("allowedVehicleStates")
        if not isinstance(preconditions, list) or not preconditions or not set(preconditions) <= VEHICLE_STATES:
            raise ContractError("ROBOT_STATE_INVALID", "dispatch preconditions are invalid")
        payload = command["payload"]
        if payload.get("routeGraphVersion") != ROUTE_VERSION or payload.get("routeGraphChecksum") != ROUTE_CHECKSUM:
            raise ContractError("ROUTE_VERSION_MISMATCH", "route graph is not pinned to this agent")
        for field in ("phase", "legId", "legIndex", "legCount", "fromStopCode", "toStopCode"):
            if field not in payload:
                raise ContractError("COMMAND_SCHEMA_INVALID", f"dispatch payload is missing {field}")
        physical_leg = next((leg for leg in PHYSICAL_MANIFEST["legs"] if leg["legId"] == payload["legId"]), None)
        synthetic_leg = str(payload["legId"]).startswith("SIM_")
        if physical_leg is None and not synthetic_leg:
            raise ContractError("ROUTE_SEGMENT_NOT_ALLOWED", "physical leg is not in the pinned manifest")
        if physical_leg is not None and (
            PHYSICAL_MANIFEST.get("capabilityEnabled") is not True
            or PHYSICAL_MANIFEST.get("mappingStatus") != "approved"
            or not physical_leg.get("allowedSegmentIds")
        ):
            raise ContractError("PHYSICAL_CAPABILITY_DISABLED", "physical route mapping is not approved")
    return command


def command_event(command: dict[str, Any], event: str, sequence: int, evidence: dict[str, Any] | None = None, error_code: str | None = None) -> dict[str, Any]:
    import uuid

    result: dict[str, Any] = {
        "schemaVersion": CONTRACT_VERSION,
        "commandId": command["commandId"],
        "eventId": str(uuid.uuid4()),
        "event": event,
        "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceSequence": sequence,
        "evidence": evidence or {},
    }
    if error_code:
        result["errorCode"] = error_code
    return result
