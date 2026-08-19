#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from felt_relaunch_deadline import WARNING_ID, BrowserRelaunchDeadlineBase


class BrowserRelaunchDeadlineInfoBarSlot(BrowserRelaunchDeadlineBase):
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
