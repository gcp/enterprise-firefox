#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from felt_relaunch_deadline import WARNING_ID, BrowserRelaunchDeadlineBase


class BrowserRelaunchDeadlineWithdrawn(BrowserRelaunchDeadlineBase):
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
