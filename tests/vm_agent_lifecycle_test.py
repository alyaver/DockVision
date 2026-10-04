"""Focused lifecycle checks for the single-file Python VM agent runtime."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


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

    def write_task(
        self, status: str = "queued", task_type: str = "noop", payload: dict | None = None
    ) -> dict:
        task = {
            "runId": self.run_id,
            "taskId": f"{self.run_id}-task",
            "taskType": task_type,
            "status": status,
            "createdUtc": "2026-10-04T00:00:00Z",
            "payload": {} if payload is None else payload,
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

    def test_active_cancellation_stops_a_cooperative_builtin_execution_and_restores_idle(self) -> None:
        self.write_task(task_type="task_sequence", payload={"tasks": []})
        original_dispatch = runner.dispatch_builtin_notepad_task

        def fixture_dispatch(plan, *, abort_check, **kwargs):
            Path(self.context["cancelRequestPath"]).write_text(
                json.dumps({"runId": self.run_id, "status": "requested"}), encoding="utf-8"
            )
            abort_check()
            self.fail("The active cancellation checkpoint must stop execution.")

        runner.dispatch_builtin_notepad_task = fixture_dispatch
        try:
            self.assertTrue(runner.process_queued_active_task(self.shared_root))
        finally:
            runner.dispatch_builtin_notepad_task = original_dispatch

        task = self.read_json(Path(self.context["taskPath"]))
        result = self.read_json(Path(self.context["resultPath"]))
        heartbeat = self.read_json(self.shared_root / "agent-heartbeat.json")
        self.assertEqual(task["status"], "cancelled")
        self.assertEqual(result["status"], "cancelled")
        self.assertIn("while task execution was active", result["message"])
        self.assertEqual(heartbeat["agent"]["status"], "idle")

    def test_iteration_timeout_is_failed_and_a_later_task_can_complete(self) -> None:
        task = self.write_task(task_type="noop")
        task["runOptions"] = {"iterationTimeoutSeconds": 1}
        runner.write_json_atomically(Path(self.context["taskPath"]), task)

        def timeout_executor(context, active_task, shared_root):
            check = runner.make_execution_abort_check(context, active_task, shared_root)
            check()
            return {"status": "completed"}

        with patch.object(runner.time, "monotonic", side_effect=[0.0, 1.0]):
            self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=timeout_executor))

        timed_out_task = self.read_json(Path(self.context["taskPath"]))
        timed_out_result = self.read_json(Path(self.context["resultPath"]))
        heartbeat = self.read_json(self.shared_root / "agent-heartbeat.json")
        self.assertEqual(timed_out_task["status"], "failed")
        self.assertEqual(timed_out_result["status"], "failed")
        self.assertTrue(timed_out_result["details"]["timedOut"])
        self.assertEqual(timed_out_result["details"]["errorType"], "AgentTaskTimedOut")
        self.assertEqual(heartbeat["agent"]["status"], "idle")

        self.write_task(task_type="noop")
        self.assertTrue(runner.process_queued_active_task(self.shared_root))
        self.assertEqual(self.read_json(Path(self.context["taskPath"]))["status"], "completed")

    def test_iteration_timeout_interrupts_a_real_wait_promptly(self) -> None:
        task = self.write_task(task_type="noop")
        task["runOptions"] = {"iterationTimeoutSeconds": 1}
        runner.write_json_atomically(Path(self.context["taskPath"]), task)

        def timeout_executor(context, active_task, shared_root):
            check = runner.make_execution_abort_check(context, active_task, shared_root)
            runner.interruptible_sleep(5, check)
            self.fail("The timeout checkpoint must interrupt the active wait.")

        started = time.monotonic()
        self.assertTrue(runner.process_queued_active_task(self.shared_root, executor=timeout_executor))
        elapsed = time.monotonic() - started

        result = self.read_json(Path(self.context["resultPath"]))
        self.assertLess(elapsed, 2.0)
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["details"]["timedOut"])

    def test_selector_polling_honors_cancellation_checkpoint(self) -> None:
        class EmptyWindow:
            def descendants(self):
                return []

        checks = 0

        def cancel_on_second_check():
            nonlocal checks
            checks += 1
            if checks == 2:
                raise runner.AgentTaskCancelled("fixture selector cancellation")

        with self.assertRaisesRegex(runner.AgentTaskCancelled, "selector cancellation"):
            runner.find_control_by_candidate(
                EmptyWindow(), {"title": "Never appears"}, 5, cancel_on_second_check
            )
        self.assertEqual(checks, 2)

    def test_notepad_window_is_closed_after_cancellation_or_automation_failure(self) -> None:
        class FixtureWindow:
            def __init__(self) -> None:
                self.close_calls = 0

            def close(self) -> None:
                self.close_calls += 1

        for failure in (runner.AgentTaskCancelled("fixture cancellation"), RuntimeError("fixture failure")):
            window = FixtureWindow()
            original_execute = runner._execute_notepad_plan

            def fixture_execute(*args, **kwargs):
                kwargs["opened_window_callback"](window)
                raise failure

            runner._execute_notepad_plan = fixture_execute
            try:
                with self.assertRaises(type(failure)):
                    runner.execute_notepad_plan({"tasks": []})
            finally:
                runner._execute_notepad_plan = original_execute

            self.assertEqual(window.close_calls, 1)

    def test_terminate_child_process_tree_uses_windows_taskkill(self) -> None:
        class FixtureProcess:
            pid = 4321

            def __init__(self) -> None:
                self.terminated = False

            def poll(self):
                return 0 if self.terminated else None

            def wait(self, timeout):
                self.terminated = True

            def kill(self):
                self.terminated = True

        process = FixtureProcess()
        with patch.object(runner.os, "name", "nt"), patch.object(runner.subprocess, "run") as taskkill:
            self.assertTrue(runner.terminate_child_process_tree(process, grace_seconds=0.1))

        taskkill.assert_called_once()
        self.assertEqual(taskkill.call_args.args[0], ["taskkill", "/PID", "4321", "/T", "/F"])

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

    def test_task_sequence_uses_payload_and_returns_run_scoped_artifacts(self) -> None:
        plan = {
            "name": "Unicode fixture",
            "captureScreenshot": True,
            "tasks": [
                {"id": "click-editor", "action": "CLICK", "target": "editor"},
                {"id": "type-text", "action": "TYPE", "text": "  λ\tline one\nline two! "},
            ],
        }
        task = self.write_task(task_type="task_sequence", payload=plan)
        calls = []
        original_dispatch = runner.dispatch_builtin_notepad_task

        def fixture_dispatch(received_plan, **kwargs):
            calls.append((received_plan, kwargs))
            return {
                "status": "completed",
                "planName": received_plan["name"],
                "automationBackend": "python-pywinauto-uia",
                "openedFile": "notepad-uia-demo.txt",
                "artifacts": {
                    "controlTree": "artifacts/control-tree.txt",
                    "screenshot": f"screenshots/notepad-{task['taskId']}.png",
                },
                "startup": {"action": "OPEN_APP", "status": "completed"},
                "steps": [
                    {"id": "click-editor", "action": "CLICK", "status": "completed"},
                    {
                        "id": "type-text",
                        "action": "TYPE",
                        "status": "completed",
                        "typedCharacterCount": len(plan["tasks"][1]["text"]),
                    },
                ],
            }

        runner.dispatch_builtin_notepad_task = fixture_dispatch
        try:
            self.assertTrue(runner.process_queued_active_task(self.shared_root))
        finally:
            runner.dispatch_builtin_notepad_task = original_dispatch

        result = self.read_json(Path(self.context["resultPath"]))
        self.assertEqual(calls[0][0], plan)
        self.assertEqual(calls[0][1]["artifact_dir"], Path(self.context["artifactsRoot"]))
        self.assertEqual(calls[0][1]["artifact_relative_root"], self.run_root)
        self.assertEqual(calls[0][1]["file_dir"], Path(self.context["artifactsRoot"]))
        self.assertEqual(calls[0][1]["screenshot_dir"], Path(self.context["screenshotsRoot"]))
        self.assertEqual(calls[0][1]["screenshot_name"], f"notepad-{task['taskId']}.png")
        self.assertTrue(calls[0][1]["capture_screenshot"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["artifacts"]["controlTree"], "artifacts/control-tree.txt")
        self.assertEqual(result["artifacts"]["screenshot"], f"screenshots/notepad-{task['taskId']}.png")
        self.assertEqual(result["details"]["taskType"], "task_sequence")
        self.assertEqual(result["details"]["totalStepCount"], 2)
        self.assertEqual(result["details"]["clickedStepCount"], 1)
        self.assertEqual(result["details"]["typedStepCount"], 1)
        self.assertEqual(result["details"]["typedCharacterCount"], len(plan["tasks"][1]["text"]))
        self.assertEqual(result["details"]["steps"][1]["id"], "type-text")

    def test_task_sequence_falls_back_to_run_task_plan_when_payload_is_not_an_object(self) -> None:
        plan = {"name": "Fallback", "captureScreenshot": False, "tasks": []}
        task = self.write_task(task_type="task_sequence", payload=None)
        task.pop("payload")
        runner.write_json_atomically(Path(self.context["taskPath"]), task)
        (self.run_root / "task-plan.json").write_text(json.dumps(plan), encoding="utf-8")
        observed = {}
        original_dispatch = runner.dispatch_builtin_notepad_task

        def fixture_dispatch(received_plan, **kwargs):
            observed["plan"] = received_plan
            observed["capture_screenshot"] = kwargs["capture_screenshot"]
            return {"status": "completed", "artifacts": {}, "steps": []}

        runner.dispatch_builtin_notepad_task = fixture_dispatch
        try:
            self.assertTrue(runner.process_queued_active_task(self.shared_root))
        finally:
            runner.dispatch_builtin_notepad_task = original_dispatch

        self.assertEqual(observed["plan"], plan)
        self.assertFalse(observed["capture_screenshot"])
        result = self.read_json(Path(self.context["resultPath"]))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["details"]["totalStepCount"], 0)

    def test_diagnostic_artifacts_use_the_active_run_as_the_relative_root(self) -> None:
        artifact_root = self.run_root / "artifacts"

        class FixtureControl:
            def __init__(self, name: str) -> None:
                self.name = name

            def window_text(self) -> str:
                return self.name

            def descendants(self) -> list:
                return []

        window = FixtureControl("Fixture Notepad")
        control_tree = runner.write_control_tree(
            window,
            artifact_root / "control-tree.txt",
            relative_root=self.run_root,
        )
        snapshot = runner.write_control_snapshot(
            window,
            artifact_root / "dialog.txt",
            "Fixture dialog",
            relative_root=self.run_root,
        )
        original_list_windows = runner.list_visible_top_level_windows
        runner.list_visible_top_level_windows = lambda: []
        try:
            top_level = runner.write_top_level_windows_snapshot(
                artifact_root / "windows.txt",
                "Fixture windows",
                relative_root=self.run_root,
            )
        finally:
            runner.list_visible_top_level_windows = original_list_windows

        self.assertEqual(control_tree["path"], "artifacts/control-tree.txt")
        self.assertEqual(snapshot["path"], "artifacts/dialog.txt")
        self.assertEqual(top_level["path"], "artifacts/windows.txt")
        self.assertTrue((artifact_root / "control-tree.txt").is_file())
        self.assertTrue((artifact_root / "dialog.txt").is_file())
        self.assertTrue((artifact_root / "windows.txt").is_file())

    def test_agent_file_path_is_constrained_to_the_active_artifacts_directory(self) -> None:
        artifacts_root = Path(self.context["artifactsRoot"])
        self.assertEqual(
            runner.resolve_notepad_file_path(r"..\outside\proof.txt", file_dir=artifacts_root),
            artifacts_root / "proof.txt",
        )
        self.assertEqual(
            runner.resolve_notepad_file_path("nested/proof.txt", file_dir=artifacts_root),
            artifacts_root / "proof.txt",
        )


if __name__ == "__main__":
    unittest.main()