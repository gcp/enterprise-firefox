#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import json
import time

from felt_consts import firefox_config
from felt_tests import FeltTests
from marionette_driver import errors

WARNING_ID = "ENTERPRISE_RELAUNCH_WARNING"
IMMINENT_ID = "ENTERPRISE_RELAUNCH_IMMINENT"


class BrowserRelaunchDeadlineBase(FeltTests):
    """Shared helpers for console-driven relaunch deadline tests."""

    def serve_relaunch(self, relaunch):
        """Serves a restart budget (or none) and waits one polling interval."""
        self.relaunch.value = json.dumps(relaunch) if relaunch is not None else ""
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
