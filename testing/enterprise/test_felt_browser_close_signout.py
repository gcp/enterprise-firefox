#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from multiprocessing import Value

from base_test import Environment
from felt_tests import FeltLogoutChecker, FeltTests


class BrowserCloseSignout(FeltTests):
    def setUp(self):
        self.logout_post_received = Value("B", 0)
        super().setUp()

    def get_tokens(self, env):
        driver = self.get_driver(env)
        with driver.using_context("chrome"):
            return driver.execute_script(
                "return [Services.felt.getAccessTokenIfValid(), Services.felt.getRefreshToken()];"
            )

    def test_browser_close_signout(self):
        self.get_driver(Environment.FELT).set_prefs(
            {
                "enterprise.felt_tests.should_not_close_window": True,
                "enterprise.felt_tests.is_blocking_shutdown": True,
            },
            default_branch=True,
        )
        self.run_felt_base()
        self.connect_child_browser()

        browser_pid = self._child_driver.session_capabilities["moz:processID"]
        self.assert_user_signed_in(env=Environment.FIREFOX)

        felt_tokens_before = self.get_tokens(Environment.FELT)
        assert len(felt_tokens_before[0]) > 0, "FELT access token should be set before close"
        assert len(felt_tokens_before[1]) > 0, "FELT refresh token should be set before close"

        firefox_tokens_before = self.get_tokens(Environment.FIREFOX)
        assert len(firefox_tokens_before[0]) > 0, "Firefox access token should be set before close"
        assert len(firefox_tokens_before[1]) > 0, "Firefox refresh token should be set before close"

        # Disable the confirmation prompt so showSignoutPrompt() returns true
        # immediately and the appShutdownConfirmed blocker proceeds with signout.
        with self._child_driver.using_context("chrome"):
            self._child_driver.execute_script(
                "Services.prefs.setBoolPref('enterprise.promptOnSignout', false);"
            )

        # Use Marionette's application-level quit (Marionette:Quit command)
        # which fires quit-application-requested through the proper channel,
        # triggering the FELT signout flow in BrowserGlue._onQuitRequest.
        logout_checker = FeltLogoutChecker(self)
        with logout_checker.assert_browser_logouts_with("normal"):
            try:
                self._child_driver._request_in_app_shutdown()
            except OSError:
                pass
            self._child_driver.delete_session(send_request=False)
            self._manually_closed_child = True

        self.wait_process_exit(browser_pid)

        assert self.logout_post_received.value == 1, (
            "Console server should have received POST /sso/logout"
        )

        self.await_felt_auth_window()
        self.force_window()
        felt_tokens_after = self.get_tokens(Environment.FELT)
        assert felt_tokens_after[0] == "", (
            f"FELT access token should be cleared after close-triggered signout, got: {felt_tokens_after[0]}"
        )
        assert felt_tokens_after[1] == "", (
            f"FELT refresh token should be cleared after close-triggered signout, got: {felt_tokens_after[1]}"
        )

        self.assert_user_signed_out(env=Environment.FELT)
