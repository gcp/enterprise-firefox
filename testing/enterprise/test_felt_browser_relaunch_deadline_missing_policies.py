#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from felt_relaunch_deadline import WARNING_ID, BrowserRelaunchDeadlineBase


class BrowserRelaunchDeadlineMissingPolicies(BrowserRelaunchDeadlineBase):
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
