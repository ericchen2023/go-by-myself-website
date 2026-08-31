import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch

from agent import ControlPlane, ControlPlaneResponseError, ControlPlaneScopeError, main as agent_main
from connection_check import failure_summary, safe_summary


class ConnectionCheckTests(unittest.TestCase):
    def test_summary_contains_no_credentials_or_precise_pose(self) -> None:
        vehicle_id = "52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2"
        result = safe_summary(vehicle_id, {
            "vehicle_id": vehicle_id,
            "vehicle_state": "idle",
            "connectivity": "offline",
            "pose": {"x": 118.42, "y": 3.07},
            "authorization": "Bearer should-never-appear",
        })
        encoded = json.dumps(result)
        self.assertTrue(result["vehicleScopeMatched"])
        self.assertNotIn("pose", encoded)
        self.assertNotIn("Bearer", encoded)
        self.assertEqual(
            set(result),
            {"ok", "authenticated", "vehicleScopeMatched", "vehicleId", "vehicleState", "connectivity"},
        )

    def test_control_plane_fails_closed_on_malformed_state(self) -> None:
        vehicle_id = "52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2"
        control_plane = ControlPlane("https://example.invalid", vehicle_id, "gbm-01", "dummy")
        control_plane.vehicle_state = lambda: {}  # type: ignore[method-assign]
        with self.assertRaises(ControlPlaneScopeError):
            control_plane.verify_identity_scope()

    def test_agent_startup_enforces_identity_preflight(self) -> None:
        environment = {
            "CONTROL_PLANE_URL": "https://example.invalid",
            "ROBOT_VEHICLE_ID": "52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2",
            "ROBOT_CLIENT_ID": "gbm-01",
            "ROBOT_CLIENT_TOKEN": "dummy",
            "GATEWAY_DEPLOY_ENV": "staging",
            "PYTHON_AGENT_ADAPTER": "dry-run",
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(
            ControlPlane,
            "verify_identity_scope",
            side_effect=ControlPlaneScopeError("scope mismatch"),
        ):
            with self.assertRaisesRegex(SystemExit, "preflight failed"):
                agent_main()

    def test_http_failure_reports_stable_code_without_response_body(self) -> None:
        body = io.BytesIO(b'{"error":{"code":"ROBOT_IDENTITY_INVALID","message":"hidden"}}')
        error = urllib.error.HTTPError("https://example.invalid", 401, "Unauthorized", {}, body)
        result = failure_summary(error)
        self.assertEqual(result["httpStatus"], 401)
        self.assertEqual(result["errorCode"], "ROBOT_IDENTITY_INVALID")
        self.assertNotIn("message", result)

    def test_malformed_response_reports_stable_error_without_traceback(self) -> None:
        class MalformedResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            @staticmethod
            def read():
                return b"not-json"

        control_plane = ControlPlane("https://example.invalid", "52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2", "gbm-01", "dummy")
        with patch("agent.urllib.request.urlopen", return_value=MalformedResponse()):
            with self.assertRaises(ControlPlaneResponseError) as raised:
                control_plane.vehicle_state()
        result = failure_summary(raised.exception)
        self.assertEqual(result["errorCode"], "CONTROL_PLANE_RESPONSE_INVALID")
        self.assertNotIn("message", result)


if __name__ == "__main__":
    unittest.main()
