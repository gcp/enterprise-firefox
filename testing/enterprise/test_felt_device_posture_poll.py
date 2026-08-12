#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys
import time

sys.path.append(os.path.dirname(__file__))

import requests
from felt_tests import FeltTests


class FeltDevicePosturePoll(FeltTests):
    """Verify that the FELT posture monitor reports posture -- including the
    profile's installed extensions -- on its polling cadence."""

    def test_device_posture_updated_by_poll(self):
        self.policy_extensions.value = 1
        super().run_felt_base()
        self.connect_child_browser()
        self.run_posture_updated_by_monitor()

    def get_device_posture(self):
        console_addr = f"http://localhost:{self.console_port}"
        r = requests.get(f"{console_addr}/sso/get_device_posture")
        return r.json()

    def run_posture_updated_by_monitor(self):
        # Poll the mock server until the FELT posture monitor has reported a
        # posture (via a posture-carrying token refresh) that includes the
        # force-installed extension read from the profile on disk.
        max_tries = 40
        for attempt in range(max_tries):
            posture = self.get_device_posture()
            # posture is null until the first submission lands.
            extensions = (posture or {}).get("extensions") or []
            ext_ids = [e["id"] for e in extensions]
            if "treestyletab@piro.sakura.ne.jp" in ext_ids:
                break
            time.sleep(0.5)
        else:
            assert False, (
                "Device posture from policy poll did not include the "
                "force-installed extension within the timeout"
            )

        app_name = self._driver.session_capabilities.get("browserName")
        expected_app_name = None
        if app_name == "firefox":
            expected_app_name = "FirefoxEnterprise"
        elif app_name == "thunderbird":
            expected_app_name = "ThunderbirdEnterprise"
        else:
            assert False, f"Unsupported app {app_name}"

        assert "name" in posture["os"], "Posture from poll reports OS name"
        assert posture["build"]["applicationName"] == expected_app_name, (
            f"Expected posture from poll to report applicationName: '{expected_app_name}' but got '{posture['build']['applicationName']}'"
        )

        tst = next(e for e in extensions if e["id"] == "treestyletab@piro.sakura.ne.jp")
        assert tst["name"] == "Tree Style Tab", (
            f"Extension display name is 'Tree Style Tab', got '{tst['name']}'"
        )
        assert tst["type"] == "extension", (
            f"Extension type is 'extension', got '{tst['type']}'"
        )
        assert len(tst["version"]) > 0, "Extension has a version string"
        assert tst["enabled"] is True, "Force-installed extension is enabled"
