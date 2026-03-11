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


class FeltDevicePosture(FeltTests):
    def test_felt_device_posture(self):
        super().run_felt_base()
        self.run_device_posture_content()
        self.run_access()
        self.run_posture_history()

    def get_device_posture(self):
        console_addr = f"http://localhost:{self.console_port}"
        max_try = 0
        while max_try < 20:
            max_try += 1
            try:
                r = requests.get(f"{console_addr}/sso/get_device_posture")
                return r.json()
            except Exception as ex:
                self._logger.info(f"Console not yet online at {console_addr}: {ex}")
                time.sleep(0.5)

        """
    def test_felt_1_perform_sso_auth(self):
        TODO: Behavior is not yet clearly defined
        self._logger.info("Setting forbidden device posture")
        self.device_posture_reply_forbidden.value = 1
        self._manually_closed_child = True
        self._logger.info("Setting forbidden device posture done")
        return super().test_felt_1_perform_sso_auth(exp)
        """

    def run_device_posture_content(self):
        device_posture = self.get_device_posture()
        assert "name" in device_posture["os"], "Device posture reports OS name"
        assert "version" in device_posture["os"], "Device posture reports OS version"
        assert device_posture["build"]["applicationName"] == "FirefoxEnterprise", (
            "Device posture reports proper applicationName"
        )
        assert "secureBootEnabled" in device_posture
        assert "mobileEquipmentId" in device_posture["network"], (
            "Device posture reports IMEI/MEID"
        )

        assert len(device_posture["network"]["interfaces"]) >= 1, (
            "Device posture reports at least one network interface"
        )

        found_one_ipv4 = False
        found_one_ipv6 = False

        for interface in device_posture["network"]["interfaces"]:
            if sys.platform == "linux" or sys.platform == "darwin":
                assert not interface["name"].startswith("lo"), (
                    "Device posture should not report loopback"
                )
            elif sys.platform == "win32":
                assert "loopback" not in interface["name"].lower(), (
                    "Device posture should not report loopback"
                )

            assert len(interface["mac"]) == 17, "Device posture reports MAC address"

            """
            Not all interfaces are expected to have IPv4 and/or IPv6 but we
            should have at least one of each over all interfaces.
            """

            num_ipv4 = len(interface["ipv4"])
            num_ipv6 = len(interface["ipv6"])

            assert num_ipv4 >= 0, "Device posture reports network interface IPv4"

            assert num_ipv6 >= 0, "Device posture reports network interface IPv6"

            if num_ipv4 > 0:
                found_one_ipv4 = True

            if num_ipv6 > 0:
                found_one_ipv6 = True

        assert found_one_ipv4, "Device posture reports network interfaces (IPv4)"

        assert found_one_ipv6, "Device posture reports network interfaces (IPv6)"

        assert "extensions" in device_posture, "Device posture reports extensions"

    def run_posture_history(self):
        console_addr = f"http://localhost:{self.console_port}"
        # Wait until at least one posture has a non-null extensions field,
        # meaning the browser poll sent it after AddonManager was ready.
        max_tries = 40
        for _ in range(max_tries):
            r = requests.get(f"{console_addr}/sso/get_device_posture_history")
            history = r.json()
            has_extensions = any(p["extensions"] is not None for p in history)
            if len(history) >= 2 and has_extensions:
                break
            time.sleep(0.5)
        else:
            assert False, (
                f"Expected a posture with extensions list, got {len(history)} "
                f"submissions all with null extensions"
            )

        # The first posture comes from the FELT UI where AddonManager is
        # unavailable, so extensions must be null (not yet known).
        assert history[0]["extensions"] is None, (
            "First posture (FELT UI) has null extensions"
        )
        # Once the browser poll fires (after AddonManager is ready),
        # extensions must be a list.
        browser_posture = next(p for p in history if p["extensions"] is not None)
        assert isinstance(browser_posture["extensions"], list), (
            "Browser poll posture has extensions list"
        )

    def run_access(self):
        """
        TODO: Behavior is not yet clearly defined
        token_data = json.loads(
            self.find_elem_by_id("token_data").get_attribute("innerHTML")
        )
        assert len(token_data["access_token"]) == 0, "There is not access token"
        assert len(token_data["refresh_token"]) == 0, "There is not refresh token"
        """
        self.connect_child_browser()
