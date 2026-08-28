from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import time
import unittest
import urllib.error

from agent import Agent, DurableLedger
from contract import ContractError, validate_command


class ContractTests(unittest.TestCase):
    def setUp(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "contracts" / "fixtures.json").read_text(encoding="utf-8"))
        self.command = fixtures["commands"][0]

    def test_accepts_v2_fixture(self) -> None:
        now = datetime(2026, 8, 22, 2, 1, tzinfo=timezone.utc)
        self.assertEqual(validate_command(self.command, self.command["vehicleId"], now)["schemaVersion"], 2)

    def test_rejects_unknown_version(self) -> None:
        with self.assertRaises(ContractError):
            validate_command({**self.command, "schemaVersion": 3}, self.command["vehicleId"])

    def test_cancel_has_no_state_precondition(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "contracts" / "fixtures.json").read_text(encoding="utf-8"))
        cancel = fixtures["commands"][1]
        self.assertNotIn("preconditions", validate_command(cancel, cancel["vehicleId"], datetime(2026, 8, 22, 2, 3, tzinfo=timezone.utc)))

    def test_transport_failure_cannot_replace_a_completed_physical_result(self) -> None:
        command = {**self.command, "expiresAt": "2099-08-22T02:30:00Z"}

        class ControlPlaneStub:
            vehicle_id = command["vehicleId"]

            def __init__(self) -> None:
                self.attempts = 0
                self.delivered = []

            def post_event(self, event):
                self.attempts += 1
                if self.attempts <= 2:
                    raise urllib.error.URLError("temporary transport failure")
                self.delivered.append(event)

        class HardwareStub:
            @staticmethod
            def execute(_command):
                return {"state": "completed", "evidence": {"arrival": "verified"}}

        with tempfile.TemporaryDirectory() as directory:
            ledger = DurableLedger(Path(directory) / "ledger.json")
            control_plane = ControlPlaneStub()
            agent = Agent(control_plane, HardwareStub(), ledger)
            agent.accept(command)
            deadline = time.monotonic() + 2
            while command["commandId"] in agent.active and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(ledger.get(command["commandId"])["finalEvent"]["event"], "completed")
            agent.accept(command)
            self.assertEqual(control_plane.delivered[-1]["event"], "completed")
            agent.executor.shutdown(wait=True)


if __name__ == "__main__":
    unittest.main()
