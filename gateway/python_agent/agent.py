"""Outbound-only Jetson agent skeleton for supervised route validation.

The command poller remains responsive while a taught-route replay runs in a
worker thread. CANCEL is therefore accepted independently of a 3–8 minute
DISPATCH. The shipped adapter is dry-run only; ROS/Aurora execution remains
fail-closed until the robot questionnaire and physical safety gates are signed.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from contract import ContractError, command_event, validate_command


class DurableLedger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.records: dict[str, Any] = {}
        if path.exists():
            self.records = json.loads(path.read_text(encoding="utf-8"))

    def get(self, command_id: str) -> Any:
        with self.lock:
            return self.records.get(command_id)

    def put(self, command_id: str, value: Any) -> None:
        with self.lock:
            self.records[command_id] = value
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(self.records, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self.path)


class DryRunHardware:
    """Contract harness only. Never enabled in a production robot image."""

    def __init__(self) -> None:
        self.state = "idle"
        self.cancel_requested = threading.Event()

    def execute(self, command: dict[str, Any]) -> dict[str, Any]:
        if command["type"] == "CANCEL":
            self.cancel_requested.set()
            self.state = "safe_stopped"
            return {"state": "completed", "evidence": {"dryRun": True, "safeStop": True}}
        allowed = command.get("preconditions", {}).get("allowedVehicleStates", [])
        if allowed and self.state not in allowed:
            return {"state": "rejected", "errorCode": "ROBOT_STATE_INVALID", "evidence": {"currentState": self.state}}
        self.cancel_requested.clear()
        self.state = "preparing"
        for _ in range(20):
            if self.cancel_requested.wait(0.05):
                return {"state": "failed", "errorCode": "COMMAND_CANCELLED_SAFE", "evidence": {"safeStop": True}}
            self.state = "moving"
        self.state = "at_stop"
        return {"state": "completed", "evidence": {"dryRun": True, "resultingVehicleState": self.state}}


class ControlPlane:
    def __init__(self, base_url: str, vehicle_id: str, client_id: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.vehicle_id = vehicle_id
        self.headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "x-robot-client-id": client_id,
            "authorization": f"Bearer {token}",
        }

    def request(self, path: str, method: str = "GET", body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method, headers=self.headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def commands(self) -> list[dict[str, Any]]:
        query = {"vehicleId": self.vehicle_id}
        envelope = self.request(f"/api/v1/robot/commands?{urllib.parse.urlencode(query)}")
        return envelope.get("data", [])

    def post_event(self, event: dict[str, Any]) -> None:
        self.request(f"/api/v1/robot/commands/{event['commandId']}/events", "POST", event)


class Agent:
    def __init__(self, control_plane: ControlPlane, hardware: DryRunHardware, ledger: DurableLedger) -> None:
        self.control_plane = control_plane
        self.hardware = hardware
        self.ledger = ledger
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="robot-command")
        self.sequence = 0
        self.active: set[str] = set()
        self.lock = threading.Lock()

    def next_sequence(self) -> int:
        with self.lock:
            self.sequence += 1
            return self.sequence

    def accept(self, raw: dict[str, Any]) -> None:
        try:
            command = validate_command(raw, self.control_plane.vehicle_id)
        except ContractError as error:
            if isinstance(raw, dict) and raw.get("commandId"):
                self.post_event_safely(command_event(raw, "rejected", self.next_sequence(), error_code=error.code))
            return
        prior = self.ledger.get(command["commandId"])
        if prior and prior.get("finalEvent"):
            self.post_event_safely(prior["finalEvent"])
            return
        with self.lock:
            is_active = command["commandId"] in self.active
        if prior or is_active:
            if prior and prior.get("acceptedEvent"):
                self.post_event_safely(prior["acceptedEvent"])
            return
        accepted = command_event(command, "accepted", self.next_sequence())
        self.ledger.put(command["commandId"], {"acceptedEvent": accepted})
        with self.lock:
            self.active.add(command["commandId"])
        accepted_delivery = self.executor.submit(self.post_event_safely, accepted)
        self.executor.submit(self.finish, command, accepted, accepted_delivery)

    def post_event_safely(self, event: dict[str, Any]) -> bool:
        try:
            self.control_plane.post_event(event)
            return True
        except Exception:
            return False

    def finish(self, command: dict[str, Any], accepted: dict[str, Any], accepted_delivery: Any) -> None:
        try:
            try:
                result = self.hardware.execute(command)
                final = command_event(command, result["state"], self.next_sequence(), result.get("evidence", {}), result.get("errorCode"))
            except Exception as error:  # Hardware adapters must preserve failure as a terminal fact.
                final = command_event(command, "failed", self.next_sequence(), error_code=getattr(error, "code", "HARDWARE_EXECUTION_FAILED"))
            self.ledger.put(command["commandId"], {"acceptedEvent": accepted, "finalEvent": final})
            accepted_delivery.result()
            self.post_event_safely(final)
        finally:
            with self.lock:
                self.active.discard(command["commandId"])

    def run(self) -> None:
        while True:
            try:
                for command in self.control_plane.commands():
                    self.accept(command)
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(2)


def main() -> None:
    deploy_environment = os.environ.get("GATEWAY_DEPLOY_ENV", "local")
    adapter = os.environ.get("PYTHON_AGENT_ADAPTER", "dry-run")
    if adapter != "dry-run":
        raise SystemExit("Aurora/ROS adapter is not implemented; physical capability fails closed.")
    if deploy_environment == "production":
        raise SystemExit("Dry-run adapter is forbidden in production.")
    required = {name: os.environ.get(name, "") for name in ("CONTROL_PLANE_URL", "ROBOT_VEHICLE_ID", "ROBOT_CLIENT_ID", "ROBOT_CLIENT_TOKEN")}
    if not all(required.values()):
        raise SystemExit("Robot identity/control plane environment is incomplete.")
    control_plane = ControlPlane(required["CONTROL_PLANE_URL"], required["ROBOT_VEHICLE_ID"], required["ROBOT_CLIENT_ID"], required["ROBOT_CLIENT_TOKEN"])
    ledger = DurableLedger(Path(os.environ.get("PYTHON_AGENT_LEDGER", "gateway/data/python-agent-ledger.json")))
    Agent(control_plane, DryRunHardware(), ledger).run()


if __name__ == "__main__":
    main()
