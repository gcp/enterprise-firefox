#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import subprocess
import sys
import time

from felt_tests import FeltTests
from selenium.webdriver.support import expected_conditions as EC


class FeltStartsBrowserExternalLink(FeltTests):
    def __init__(self, *args, **kwargs):
        self._external_link = "https://ip.lafibre.info/"
        super().__init__(*args, **kwargs)

    def test_felt_3_browser_started(self, exp):
        self.connect_child_browser()

        if sys.platform == "linux":
            display = os.environ.get("DISPLAY", "")
            wayland = os.environ.get("WAYLAND_DISPLAY", "")
            if not display and not wayland:
                self._logger.warning(
                    f"Opening URL cannot work in headless mode, but DISPLAY={display} and WAYLAND_DISPLAY={wayland}. xvfb-run will be used."
                )

        return True

    def test_felt_4_open_external_link(self, exp):
        tabs = self._child_driver.window_handles
        self._logger.info(f"Tabs before opening external link: {tabs}")

        has_tab = False
        for tab in tabs:
            self._child_driver.switch_to.window(tab)
            self._logger.info(f"Checking: {tab} => {self._child_driver.current_url}")
            if self._child_driver.current_url.startswith(self._external_link):
                has_tab = True
                break

        assert not has_tab, f"Should not have {self._external_link} opened"

        # At least on linux, one cannot ues --headless for this, it ends up in
        # ProfileLockedDialog() because --headless disables remote client
        args = [f"{sys.argv[1]}", "-profile", self._profile_path, self._external_link]
        subprocess.check_call(args, shell=False)

        self._child_driver.switch_to.new_window("tab")
        self._child_wait.until(EC.new_window_is_opened(tabs))

        has_new_tab = False
        loops = 0
        while not has_new_tab and loops < 30:
            for tab in self._child_driver.window_handles:
                self._child_driver.switch_to.window(tab)
                self._logger.info(
                    f"Checking new tabs: {tab} => {self._child_driver.current_url}"
                )
                if self._child_driver.current_url.startswith(self._external_link):
                    has_new_tab = True
                    break
            loops += 1
            time.sleep(0.5)

        assert has_new_tab, f"Should have {self._external_link} opened"

        return True


if __name__ == "__main__":
    FeltStartsBrowserExternalLink(
        "felt_browser_external_link.json",
        firefox=sys.argv[1],
        geckodriver=sys.argv[2],
        profile_root=sys.argv[3],
        cli_args=[],
    )
