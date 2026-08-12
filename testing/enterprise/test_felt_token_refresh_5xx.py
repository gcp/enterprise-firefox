#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys
import time
import uuid

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from felt_tests import FeltTests


class FeltTokenRefresh5xx(FeltTests):
    """How the felt-managed browser handles a 5xx from the console while a
    live session is running."""

    def teardown(self):
        # The browser may have been shut down during the test; if the child
        # session is dead, skip the normal child-close path in
        # FeltTestsBase.teardown() which would otherwise error out.
        if hasattr(self, "_child_driver"):
            try:
                self._child_driver.set_context("chrome")
                self._child_driver.execute_script("return true;")
            except Exception:
                self._manually_closed_child = True
        return super().teardown()

    def test_policies_5xx_during_poll_keeps_browser_running(self):
        """A 5xx on the live policy poll leaves the browser running."""
        import psutil

        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        browser_pid = self._child_driver.session_capabilities["moz:processID"]

        # The console starts returning 5xx for the live policy poll.
        self.policies_fail_request.value = 1
        time.sleep(5)

        assert psutil.pid_exists(browser_pid), "Browser should still be running"
        self._child_driver.set_context("chrome")
        assert self._child_driver.execute_script("return true;"), (
            "Browser should still be responsive"
        )

    def test_token_refresh_5xx_recovers_felt_ui(self):
        """A 5xx on the token refresh brings FELT back and clears the tokens.

        A 401 on the policy poll makes the browser ask FELT to refresh the
        session; the refresh POST to the token endpoint then returns 5xx. After the
        browser is torn down, FELT must return to the foreground showing the
        "session interrupted" notice, and the tokens are cleared.
        """
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        browser_pid = self._child_driver.session_capabilities["moz:processID"]

        # Precondition: the session holds the tokens the console issued.
        assert self.policy_access_token.value and self.policy_refresh_token.value, (
            "Session should have tokens"
        )

        # The token endpoint returns 5xx, and the next policy poll gets a 401
        # (rotate the server access token so the browser's cached one no longer
        # matches), driving the browser to refresh into that 5xx.
        self.token_fail_request.value = 1
        self.policy_access_token.value = str(uuid.uuid4())

        self.wait_process_exit(browser_pid)

        # FELT comes back with a window instead of vanishing.
        self.await_felt_auth_window()
        self.force_window()

        self._driver.set_context("chrome")

        # It shows the "session interrupted" notice.
        self.get_elem(".felt-browser-error-session-interrupted")

        # The refresh-failure teardown clears the tokens: FELT no longer holds
        # an access or refresh token, so the user must authenticate again.
        tokens = self._driver.execute_script(
            """
            return {
                access: Services.felt.getAccessTokenIfValid(),
                refresh: Services.felt.getRefreshToken(),
            };
            """
        )
        self._driver.set_context("content")
        assert not tokens["access"], f"Access token was not cleared: {tokens['access']}"
        assert not tokens["refresh"], (
            f"Refresh token was not cleared: {tokens['refresh']}"
        )
