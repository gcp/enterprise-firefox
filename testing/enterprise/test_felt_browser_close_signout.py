#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from felt_tests import FeltLogoutChecker, FeltTests


class BrowserCloseSignout(FeltTests):
    def get_tokens(self, env):
        driver = self.get_driver(env)
        with driver.using_context("chrome"):
            return driver.execute_script(
                "return [Services.felt.getAccessTokenIfValid(), Services.felt.getRefreshToken()];"
            )

    def test_browser_close_signout(self):
        self.run_felt_base()
        self.connect_child_browser()

        browser_pid = self._child_driver.session_capabilities["moz:processID"]
        self.assert_user_signed_in(env=Environment.FIREFOX)

        # Verify both processes hold valid tokens before close.
        felt_tokens_before = self.get_tokens(Environment.FELT)
        assert len(felt_tokens_before[0]) > 0, "FELT access token should be set before close"
        assert len(felt_tokens_before[1]) > 0, "FELT refresh token should be set before close"

        firefox_tokens_before = self.get_tokens(Environment.FIREFOX)
        assert len(firefox_tokens_before[0]) > 0, "Firefox access token should be set before close"
        assert len(firefox_tokens_before[1]) > 0, "Firefox refresh token should be set before close"

        # Disable the confirmation prompt: native confirmEx dialogs block the
        # main thread and cannot be driven by Marionette.  With the pref off,
        # showSignoutPrompt() returns true immediately, _signoutAuthorized is
        # set, and the AsyncShutdown blocker signs the user out via
        # ConsoleClient.signoutUser() -> POST /sso/logout -> normalLogout().
        with self._child_driver.using_context("chrome"):
            self._child_driver.execute_script(
                "Services.prefs.setBoolPref('enterprise.promptOnSignout', false);"
            )

        logout_checker = FeltLogoutChecker(self)
        with logout_checker.assert_browser_logouts_with("normal"):
            with self._child_driver.using_context("chrome"):
                self._child_driver.execute_script(
                    "Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);"
                )
            self._manually_closed_child = True

        self.wait_process_exit(browser_pid)

        # After signout, FELT should have cleared its tokens.  The
        # token-send-back blocker in ConsoleClient is skipped because
        # _isLogoutInProgress is true, so any tokens in FELT after this
        # point came from the logout flow itself, not from the browser.
        felt_tokens_after = self.get_tokens(Environment.FELT)
        assert felt_tokens_after[0] == "", (
            f"FELT access token should be cleared after close-triggered signout, got: {felt_tokens_after[0]}"
        )
        assert felt_tokens_after[1] == "", (
            f"FELT refresh token should be cleared after close-triggered signout, got: {felt_tokens_after[1]}"
        )

        self.await_felt_auth_window()
        self.force_window()
        self.assert_user_signed_out(env=Environment.FELT)
