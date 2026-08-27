from datetime import datetime, timezone
import json
from pathlib import Path
import unittest

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


if __name__ == "__main__":
    unittest.main()
