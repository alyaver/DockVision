"""Small host-safe lifecycle sample for DOCKV-333.

The sample exercises the existing guest-agent handoff with temporary storage
and an injected executor. It never launches a guest process, sends GUI input,
or executes uploaded runner content on the development host.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


RUNNER_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "pywinauto-vm-notepad-demo"
    / "vm-notepad-runner.py"
)
RUNNER_SPEC = importlib.util.spec_from_file_location("vm_notepad_runner_sample", RUNNER_PATH)
assert RUNNER_SPEC and RUNNER_SPEC.loader
runner = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(runner)


class VmAgentLifecycleSampleTest(unittest.TestCase):
    """Representative success, failure, and cancellation lifecycle cases."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.shared_root = Path(self.temporary_directory.name)
        self.run_id = "run-dockv333-sample"
        self.context = runner.get_run_context(self.shared_root, self.run_id)
        Path(self.context["runRoot"]).mkdir(parents=True, exist_ok=True)
        active_root = self.shared_root / "active"
        active_root.mkdir(parents=True, exist_ok=True)
        (active_root / "current-run.json").write_text(
            json.dumps({"runId": self.run_id}), encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_task(self) -> None:
        task = {
            "runId": self.run_id,
            "taskId": f"{self.run_id}-task",
            "taskType": "noop",
            "status": "queued",
            "createdUtc": "2026-11-06T00:00:00Z",
            "payload": {},
        }
        runner.write_json_atomically(Path(self.context["taskPath"]), task)

    def read_json(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    def assert_terminal_and_idle(self, expected_status: str) -> None:
        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        heartbeat = self.read_json(self.shared_root / "agent-heartbeat.json")
        self.assertEqual(task["status"], expected_status)
        self.assertEqual(result["status"], expected_status)
        self.assertEqual(heartbeat["agent"]["status"], "idle")
        self.assertEqual(heartbeat["agent"]["runId"], "")

    def test_success_publishes_terminal_result_and_idle_heartbeat(self) -> None:
        self.write_task()

        def executor(context, task, shared_root):
            self.assertEqual(task["status"], "running")
            self.assertEqual(self.read_json(shared_root / "agent-heartbeat.json")["agent"]["status"], "running")
            return {"status": "completed", "message": "Sample completed."}

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=executor))
        self.assert_terminal_and_idle("completed")

    def test_execution_failure_publishes_failure_without_reexecution(self) -> None:
        self.write_task()

        def executor(context, task, shared_root):
            raise RuntimeError("controlled sample failure")

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=executor))
        self.assert_terminal_and_idle("failed")
        result = self.read_json(Path(self.context["resultPath"]))
        self.assertEqual(result["message"], "controlled sample failure")

        calls = []

        def must_not_reexecute(context, task, shared_root):
            calls.append(True)
            self.fail("A terminal task must not be executed again.")

        self.assertFalse(runner.process_queued_active_task(self.shared_root, executor=must_not_reexecute))
        self.assertEqual(calls, [])

    def test_cancellation_publishes_terminal_result_without_running_executor(self) -> None:
        self.write_task()
        Path(self.context["cancelRequestPath"]).write_text(
            json.dumps({"runId": self.run_id, "status": "requested"}), encoding="utf-8"
        )
        calls = []

        def must_not_execute(context, task, shared_root):
            calls.append(True)
            self.fail("Cancellation before execution should not invoke the executor.")

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=must_not_execute))
        self.assert_terminal_and_idle("cancelled")
        self.assertEqual(calls, [])

    def test_failure_closes_only_the_run_owned_window(self) -> None:
        class Window:
            def __init__(self) -> None:
                self.close_calls = 0

            def close(self) -> None:
                self.close_calls += 1

        owned_window = Window()
        unrelated_window = Window()

        def failing_worker(*args, **kwargs):
            kwargs["opened_window_callback"](owned_window)
            raise RuntimeError("controlled Notepad failure")

        with patch.object(runner, "_execute_notepad_plan", side_effect=failing_worker):
            with self.assertRaisesRegex(RuntimeError, "controlled Notepad failure"):
                runner.execute_notepad_plan({"name": "cleanup sample", "tasks": []})

        self.assertEqual(owned_window.close_calls, 1)
        self.assertEqual(unrelated_window.close_calls, 0)


if __name__ == "__main__":
    unittest.main()