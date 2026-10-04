"""Focused lifecycle checks for the single-file Python VM agent runtime."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


RUNNER_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "pywinauto-vm-notepad-demo"
    / "vm-notepad-runner.py"
)
RUNNER_SPEC = importlib.util.spec_from_file_location("vm_notepad_runner", RUNNER_PATH)
assert RUNNER_SPEC and RUNNER_SPEC.loader
runner = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(runner)


class VmAgentLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.shared_root = Path(self.temporary_directory.name)
        self.run_id = "run-lifecycle-test"
        self.context = runner.get_run_context(self.shared_root, self.run_id)
        self.run_root = Path(self.context["runRoot"])
        self.run_root.mkdir(parents=True, exist_ok=True)
        active_root = self.shared_root / "active"
        active_root.mkdir(parents=True, exist_ok=True)
        (active_root / "current-run.json").write_text(
            json.dumps({"runId": self.run_id}), encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_task(self, status: str = "queued", task_type: str = "noop") -> dict:
        task = {
            "runId": self.run_id,
            "taskId": f"{self.run_id}-task",
            "taskType": task_type,
            "status": status,
            "createdUtc": "2026-10-04T00:00:00Z",
            "payload": {},
        }
        runner.write_json_atomically(Path(self.context["taskPath"]), task)
        return task

    def read_json(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    def test_queued_task_completes_with_consistent_task_and_result(self) -> None:
        self.write_task()
        observed = {}

        def executor(context, task, shared_root):
            observed["task_status"] = task["status"]
            observed["persisted_status"] = self.read_json(Path(context["taskPath"]))["status"]
            observed["heartbeat"] = self.read_json(shared_root / "agent-heartbeat.json")
            return {
                "status": "completed",
                "message": "Fixture completed.",
                "artifacts": {"report": "artifacts/report.txt"},
                "details": {"executor": "fixture"},
            }

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=executor))

        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        heartbeat = self.read_json(self.shared_root / "agent-heartbeat.json")
        self.assertEqual(observed["task_status"], "running")
        self.assertEqual(observed["persisted_status"], "running")
        self.assertEqual(observed["heartbeat"]["agent"]["status"], "running")
        self.assertEqual(task["status"], "completed")
        self.assertIn("startedUtc", task)
        self.assertIn("completedUtc", task)
        self.assertEqual(result["runId"], self.run_id)
        self.assertEqual(result["taskId"], task["taskId"])
        self.assertEqual(result["status"], task["status"])
        self.assertIn("finishedUtc", result)
        self.assertEqual(result["message"], "Fixture completed.")
        self.assertEqual(result["artifacts"], {"report": "artifacts/report.txt"})
        self.assertEqual(result["details"], {"executor": "fixture"})
        self.assertEqual(heartbeat["agent"]["status"], "idle")
        self.assertEqual(heartbeat["agent"]["runId"], "")

    def test_executor_failure_publishes_failed_task_and_result(self) -> None:
        self.write_task()

        def executor(context, task, shared_root):
            raise ValueError("fixture failure")

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=executor))
        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        self.assertEqual(task["status"], "failed")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["message"], "fixture failure")
        self.assertEqual(result["details"]["errorType"], "ValueError")
        self.assertIn("completedUtc", task)

    def test_cancellation_before_execution_publishes_cancelled_task_and_result(self) -> None:
        self.write_task()
        Path(self.context["cancelRequestPath"]).write_text(
            json.dumps({"runId": self.run_id, "status": "requested"}), encoding="utf-8"
        )
        calls = []

        def executor(context, task, shared_root):
            calls.append(True)
            return {"status": "completed"}

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=executor))
        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        self.assertEqual(calls, [])
        self.assertEqual(task["status"], "cancelled")
        self.assertEqual(result["status"], "cancelled")
        self.assertIn("Cancellation was requested", result["message"])

    def test_executor_cancelled_outcome_publishes_cancelled_task_and_result(self) -> None:
        self.write_task()

        def executor(context, task, shared_root):
            return {
                "status": "cancelled",
                "message": "Fixture executor cancelled the task.",
                "details": {"reason": "fixture"},
            }

        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=executor))
        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        self.assertEqual(task["status"], "cancelled")
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(result["details"], {"reason": "fixture"})

    def test_terminal_task_is_not_executed_again(self) -> None:
        self.write_task(status="completed")

        def executor(context, task, shared_root):
            self.fail("A terminal task must not be executed again.")

        self.assertFalse(runner.process_queued_active_task(self.shared_root, executor=executor))
        self.assertFalse(Path(self.context["resultPath"]).exists())

    def test_bounded_agent_loop_claims_and_completes_one_noop_task(self) -> None:
        self.write_task(task_type="noop")
        self.assertEqual(
            runner.run_agent_loop(
                shared_root=self.shared_root,
                max_heartbeats=1,
                heartbeat_interval_seconds=0,
            ),
            0,
        )
        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        heartbeat = self.read_json(self.shared_root / "agent-heartbeat.json")
        self.assertEqual(task["status"], "completed")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(heartbeat["agent"]["status"], "idle")


if __name__ == "__main__":
    unittest.main()