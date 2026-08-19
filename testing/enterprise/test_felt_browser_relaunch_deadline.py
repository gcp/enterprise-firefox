#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import json
import os
import sys
import time

sys.path.append(os.path.dirname(__file__))

from felt_consts import firefox_config
from felt_tests import FeltTests
from marionette_driver import errors

WARNING_ID = "ENTERPRISE_RELAUNCH_WARNING"
IMMINENT_ID = "ENTERPRISE_RELAUNCH_IMMINENT"


class BrowserRelaunchDeadline(FeltTests):
    """The console drives the restart deadline through the policy poll.

    Covers the two ends of the contract: a comfortable budget warns the user,
    and an exhausted budget with no grace left restarts the browser.
    """

    def test_relaunch_deadline_warns_then_restarts(self):
        self.run_felt_base()
        self.connect_child_browser()
        browser_pid = self._child_driver.session_capabilities["moz:processID"]

        self._logger.info("Console starts asking for a restart within the hour")
        self.serve_relaunch({"MinutesRemaining": 45, "HardMinutesRemaining": 180})
        assert self.wait_for_relaunch_bar() == WARNING_ID, (
            "Expected the warning bar for a comfortable restart budget"
        )

        self.assert_relaunch_message(
            "enterprise-relaunch-warning-message", "will restart at"
        )

        self._logger.info("Console tightens the budget past the escalation threshold")
        # A zero grace period lets the soft budget govern this seconds-old session.
        self.serve_relaunch({"MinutesRemaining": 4, "GracePeriodMinutes": 0})
        self._child_wait.until(
            lambda _: self.relaunch_bar() == IMMINENT_ID,
            message="The warning did not escalate as the deadline approached",
        )

        self.assert_relaunch_message(
            "enterprise-relaunch-imminent-message", "will restart in 4 minutes"
        )

        self._logger.info("Console leaves seconds on the clock")
        # A grace period is measured from the session start, so every poll
        # re-derives the same deadline and the armed timer is what restarts.
        # Ten seconds of it are left once this poll lands.
        grace = (self.session_age_ms() + 10_000) / 60_000
        self.serve_relaunch({"MinutesRemaining": 0, "GracePeriodMinutes": grace})
        assert self.enforcer_state()["restartArmed"], (
            "Expected the restart to be waiting on a timer"
        )

        # Keep the successor from consuming the old session's short grace while
        # the server switches budgets across the restart.
        self.policies_omit_policies.value = 1
        try:
            self.wait_process_exit(browser_pid)
            self.relaunch.value = json.dumps({"MinutesRemaining": 0})
        finally:
            self.policies_omit_policies.value = 0

        self._logger.info("Connecting to the relaunched browser")
        self.connect_child_browser()
        new_browser_pid = self._child_driver.session_capabilities["moz:processID"]
        assert new_browser_pid != browser_pid, (
            f"Expected a new process, still {new_browser_pid}"
        )

        assert self.wait_for_relaunch_bar() == WARNING_ID, (
            "Expected the fresh session to warn for the length of its grace period"
        )
        schedule = self.enforcer_state()["schedule"]
        assert schedule["restartAt"] - self.process_start() == 10 * 60 * 1000, (
            f"Expected the default ten minute grace period, got {schedule}"
        )
        self.serve_relaunch({"MinutesRemaining": 0})
        assert self.process_alive(new_browser_pid), (
            "The grace period did not keep the fresh session running"
        )

    def test_relaunch_deadline_withdrawn(self):
        self.run_felt_base()
        self.connect_child_browser()

        self.serve_relaunch({"MinutesRemaining": 45})
        assert self.wait_for_relaunch_bar() == WARNING_ID, (
            "Expected the warning bar for a comfortable restart budget"
        )

        self._logger.info("Console stops asking for a restart")
        self.serve_relaunch(None)
        self._child_wait.until(
            lambda _: self.relaunch_bar() is None,
            message="Withdrawing the deadline did not remove the warning bar",
        )

    def test_relaunch_deadline_takes_the_infobar_slot(self):
        self.run_felt_base()
        self.connect_child_browser()

        self._logger.info("Another ASRouter infobar takes the slot first")
        self.show_competing_infobar("INFOBAR_LAUNCH_ON_LOGIN")
        assert self.infobar_values() == ["INFOBAR_LAUNCH_ON_LOGIN"], (
            f"Expected the competing bar to hold the slot, got {self.infobar_values()}"
        )

        self.serve_relaunch({"MinutesRemaining": 45})
        assert self.wait_for_relaunch_bar() == WARNING_ID, (
            "The relaunch bar did not take the slot from the competing infobar"
        )

    def test_relaunch_countdown_keeps_the_button_focused(self):
        self.run_felt_base()
        self.connect_child_browser()

        self.serve_relaunch({"MinutesRemaining": 4, "GracePeriodMinutes": 0})
        assert self.wait_for_relaunch_bar() == IMMINENT_ID, (
            "Expected the imminent bar for a budget inside the threshold"
        )
        self.assert_relaunch_message(
            "enterprise-relaunch-imminent-message", "will restart in 4 minutes"
        )

        self._logger.info("Focusing the restart button, then counting down")
        self.focus_restart_button()
        self.serve_relaunch({"MinutesRemaining": 3, "GracePeriodMinutes": 0})

        self.assert_relaunch_message(
            "enterprise-relaunch-imminent-message", "will restart in 3 minutes"
        )
        kept = self.check_focus_kept()
        assert kept["sameBar"], "The countdown replaced the bar instead of updating it"
        assert kept["focused"], "The countdown took focus off the restart button"

    def focus_restart_button(self):
        """Focuses the bar's button, remembering it and the bar it belongs to."""
        self._child_driver.set_context("chrome")
        self._child_driver.execute_script(
            """
            const win = Services.wm.getMostRecentBrowserWindow();
            const bar = win.gNotificationBox.getNotificationWithValue(
                arguments[0]
            );
            win._relaunchTestBar = bar;
            win._relaunchTestButton = bar.buttonContainer.querySelector("button");
            win._relaunchTestButton.focus();
            """,
            script_args=(IMMINENT_ID,),
        )

    def check_focus_kept(self):
        self._child_driver.set_context("chrome")
        try:
            result = self._child_driver.execute_script(
                """
                const win = Services.wm.getMostRecentBrowserWindow();
                const bar = win.gNotificationBox.getNotificationWithValue(
                    arguments[0]
                );
                const result = {
                    sameBar: bar === win._relaunchTestBar,
                    focused: win.document.activeElement === win._relaunchTestButton,
                };
                delete win._relaunchTestBar;
                delete win._relaunchTestButton;
                return result;
                """,
                script_args=(IMMINENT_ID,),
            )
        finally:
            self._child_driver.set_context("content")
        return result

    def test_relaunch_deadline_survives_a_response_without_policies(self):
        self.run_felt_base()
        self.connect_child_browser()

        self.serve_relaunch({"MinutesRemaining": 45})
        assert self.wait_for_relaunch_bar() == WARNING_ID, (
            "Expected the warning bar for a comfortable restart budget"
        )

        self._logger.info("Console starts answering polls with no policies at all")
        self.policies_omit_policies.value = 1
        self.serve_relaunch({"MinutesRemaining": 45})
        try:
            assert self.relaunch_bar() == WARNING_ID, (
                "A response carrying no policies withdrew the restart deadline"
            )
        finally:
            self.policies_omit_policies.value = 0

    def test_relaunch_deadline_returns_after_the_bar_is_removed(self):
        self.run_felt_base()
        self.connect_child_browser()

        self.serve_relaunch({"MinutesRemaining": 45})
        assert self.wait_for_relaunch_bar() == WARNING_ID, (
            "Expected the warning bar for a comfortable restart budget"
        )

        self._logger.info("Something else removes the bar")
        self.remove_relaunch_bar()
        # removeNotification() takes the bar out of the box asynchronously.
        self._child_wait.until(
            lambda _: self.relaunch_bar() is None,
            message="The bar is still up",
        )

        # A refresh deriving the same text as the removed bar, as a poll does
        # once the console decrements the budget in step with real time.
        self.refresh_relaunch_bar()
        assert self.relaunch_bar() == WARNING_ID, (
            "A later refresh did not put the warning bar back"
        )

    def enforcer_state(self):
        """The armed deadline.

        testingOnly_getState() is gated on Cu.isInAutomation, which is off in a
        Marionette-driven browser.
        """
        self._child_driver.set_context("chrome")
        return self._child_driver.execute_script(
            """
            const { RelaunchEnforcer } = ChromeUtils.importESModule(
              "resource://gre/modules/enterprise/RelaunchEnforcer.sys.mjs"
            );
            return {
                schedule: RelaunchEnforcer._schedule,
                restartArmed: !!RelaunchEnforcer._restartTask?.isArmed,
            };
            """
        )

    def process_start(self):
        self._child_driver.set_context("chrome")
        try:
            return self._child_driver.execute_script(
                "return Services.startup.getStartupInfo().process.getTime();"
            )
        finally:
            self._child_driver.set_context("content")

    def session_age_ms(self):
        self._child_driver.set_context("chrome")
        return self._child_driver.execute_script(
            """
            return Date.now() - Services.startup.getStartupInfo().process.getTime();
            """
        )

    def process_alive(self, pid):
        import psutil

        return psutil.pid_exists(pid)

    def refresh_relaunch_bar(self):
        self._child_driver.set_context("chrome")
        self._child_driver.execute_async_script(
            """
            const resolve = arguments[arguments.length - 1];
            const { RelaunchEnforcer } = ChromeUtils.importESModule(
              "resource://gre/modules/enterprise/RelaunchEnforcer.sys.mjs"
            );
            RelaunchEnforcer._refreshNotification().then(() => resolve(true));
            """
        )

    def remove_relaunch_bar(self):
        """Removes the relaunch bar the way InfoBar evicts an incumbent."""
        self._child_driver.set_context("chrome")
        self._child_driver.execute_script(
            """
            const { InfoBar } = ChromeUtils.importESModule(
              "resource:///modules/asrouter/InfoBar.sys.mjs"
            );
            InfoBar._activeInfobar.notification.removeUniversalInfobars();
            """
        )

    def show_competing_infobar(self, message_id):
        """Puts another ASRouter infobar in the single slot InfoBar serves."""
        self._child_driver.set_context("chrome")
        self._child_driver.execute_async_script(
            """
            const [messageId, resolve] = [arguments[0], arguments[arguments.length - 1]];
            const { InfoBar } = ChromeUtils.importESModule(
              "resource:///modules/asrouter/InfoBar.sys.mjs"
            );
            const win = Services.wm.getMostRecentBrowserWindow();
            InfoBar.showInfoBarMessage(
              win.gBrowser.selectedBrowser,
              {
                id: messageId,
                content: {
                  type: "global",
                  priority: win.gNotificationBox.PRIORITY_INFO_HIGH,
                  text: "Occupying the slot",
                  buttons: [],
                },
                template: "infobar",
                targeting: "true",
              },
              () => {}
            ).then(() => resolve(true));
            """,
            script_args=(message_id,),
        )

    def infobar_values(self):
        self._child_driver.set_context("chrome")
        return self._child_driver.execute_script(
            """
            const win = Services.wm.getMostRecentBrowserWindow();
            return [...win.gNotificationBox.allNotifications].map(
                n => n.getAttribute("value")
            );
            """
        )

    def serve_relaunch(self, relaunch):
        """Serves a restart budget (or none) and waits one polling interval."""
        self.relaunch.value = json.dumps(relaunch) if relaunch else ""
        waiting_time = (firefox_config["polling_frequency"]["pref_value"] / 1000) + 1
        time.sleep(waiting_time)

    def relaunch_bar(self):
        """The id of the visible relaunch bar, or None."""
        found = self.relaunch_bar_with_text()
        return found[0] if found else None

    def relaunch_bar_with_text(self):
        """The visible relaunch bar as [id, fluent id, rendered text], or None.

        <remote-text> renders the message into an open shadow root.
        """
        self._child_driver.set_context("chrome")
        return self._child_driver.execute_script(
            """
            const ids = arguments[0];
            const win = Services.wm.getMostRecentBrowserWindow();
            for (const n of win.gNotificationBox.allNotifications) {
                const value = n.getAttribute("value");
                if (ids.includes(value)) {
                    const remote = n.querySelector("remote-text");
                    return [
                        value,
                        remote?.getAttribute("fluent-remote-id") ?? "",
                        remote?.shadowRoot?.textContent ?? "",
                    ];
                }
            }
            return null;
            """,
            script_args=([WARNING_ID, IMMINENT_ID],),
        )

    def assert_relaunch_message(self, fluent_id, expected):
        """Asserts the bar carries the expected Fluent string and renders it.

        The message is slotted in and translated after the bar is appended.
        """

        def rendered(_):
            found = self.relaunch_bar_with_text()
            return found and found[1] == fluent_id and expected in found[2]

        try:
            self._child_wait.until(rendered)
        except errors.TimeoutException:
            found = self.relaunch_bar_with_text()
            raise AssertionError(
                f"Expected {fluent_id} rendering {expected!r}, got {found!r}"
            )

    def wait_for_relaunch_bar(self):
        return self._child_wait.until(
            lambda _: self.relaunch_bar(),
            message="The relaunch warning bar never appeared",
        )
