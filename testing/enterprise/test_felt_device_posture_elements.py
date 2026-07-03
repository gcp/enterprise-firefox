#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import json
import os
import sys

sys.path.append(os.path.dirname(__file__))

from felt_tests import FeltTests


class FeltDevicePostureElements(FeltTests):
    """The console drives which EDR agents device posture probes.

    The console publishes a `posture_elements` descriptor in the browser config;
    Felt stores it into the enterprise.posture.* prefs, and
    ConsoleClient.collectDevicePosture uses it -- probing nothing when unset (it
    must never fall back to probing every known EDR agent). The descriptor is also
    expected to carry a parallel osquery query list, but osquery collection is not
    implemented yet, so it is not exercised here.
    """

    POSTURE_ELEMENTS = {
        "edr": ["crowdstrike"],
    }

    def test_posture_elements(self):
        # The config is fetched before the child browser starts, so the console
        # must serve posture_elements before run_felt_base().
        self.config_posture_elements.value = json.dumps(
            self.POSTURE_ELEMENTS, separators=(",", ":")
        )
        super().run_felt_base()
        self.connect_child_browser()

        self.run_config_pref_plumbing()
        self.run_console_driven_probes()
        self.run_probe_none_when_unconfigured()

    def _wait_for_string_pref(self, name):
        self._child_driver.set_context("chrome")
        try:
            return self._child_longwait.until(
                lambda _: self._child_driver.execute_script(
                    f"return Services.prefs.getStringPref('{name}', '') || null;"
                )
            )
        finally:
            self._child_driver.set_context("content")

    def run_config_pref_plumbing(self):
        """The config's posture_elements is pushed to the browser as JSON prefs."""
        edr_pref = self._wait_for_string_pref("enterprise.posture.edr_agents")
        assert json.loads(edr_pref) == self.POSTURE_ELEMENTS["edr"], (
            f"edr_agents pref reflects the console config, got {edr_pref}"
        )

    def run_console_driven_probes(self):
        """collectDevicePosture probes exactly the console-configured EDR list."""
        self._child_driver.set_context("chrome")
        try:
            rv = self._child_driver.execute_async_script(
                """
                const callback = arguments[arguments.length - 1];
                const edrMod = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/EdrDetection.sys.mjs"
                );
                const { ConsoleClient } = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/ConsoleClient.sys.mjs"
                );
                // Spy on getPresentEdrs so we can assert which agents were
                // requested without depending on what is installed on the host.
                const original = edrMod.EdrDetection.getPresentEdrs;
                let recorded = null;
                edrMod.EdrDetection.getPresentEdrs = ids => {
                  recorded = ids;
                  return Promise.resolve([]);
                };
                ConsoleClient.collectDevicePosture()
                  .then(posture => {
                    edrMod.EdrDetection.getPresentEdrs = original;
                    callback({
                      recorded,
                      presentEdrs: posture.presentEdrs,
                    });
                  })
                  .catch(err => {
                    edrMod.EdrDetection.getPresentEdrs = original;
                    callback({ _error: String(err) });
                  });
                """
            )
        finally:
            self._child_driver.set_context("content")

        assert "_error" not in rv, f"collectDevicePosture threw: {rv.get('_error')}"
        assert rv["recorded"] == self.POSTURE_ELEMENTS["edr"], (
            f"getPresentEdrs called with the console-configured list, got {rv['recorded']}"
        )

    def run_probe_none_when_unconfigured(self):
        """With no EDR configured, getPresentEdrs is never called (an empty list
        would otherwise mean 'probe every known agent')."""
        # Both an explicit empty list and an absent/cleared pref must probe none.
        for edr_pref_value in ["[]", None]:
            rv = self._collect_with_edr_spy(edr_pref_value)
            assert "_error" not in rv, f"collectDevicePosture threw: {rv.get('_error')}"
            assert rv["called"] is False, (
                "getPresentEdrs must not be called when no EDR is configured "
                f"(edr_agents={edr_pref_value!r})"
            )
            assert rv["presentEdrs"] == [], (
                f"presentEdrs is empty when no EDR configured, got {rv['presentEdrs']}"
            )

    def _collect_with_edr_spy(self, edr_pref_value):
        if edr_pref_value is None:
            set_pref_js = (
                "Services.prefs.clearUserPref('enterprise.posture.edr_agents');"
            )
        else:
            set_pref_js = (
                "Services.prefs.setStringPref('enterprise.posture.edr_agents', "
                f"{json.dumps(edr_pref_value)});"
            )
        self._child_driver.set_context("chrome")
        try:
            return self._child_driver.execute_async_script(
                set_pref_js
                + """
                const callback = arguments[arguments.length - 1];
                const edrMod = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/EdrDetection.sys.mjs"
                );
                const { ConsoleClient } = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/ConsoleClient.sys.mjs"
                );
                const original = edrMod.EdrDetection.getPresentEdrs;
                let called = false;
                edrMod.EdrDetection.getPresentEdrs = ids => {
                  called = true;
                  return original(ids);
                };
                ConsoleClient.collectDevicePosture()
                  .then(posture => {
                    edrMod.EdrDetection.getPresentEdrs = original;
                    callback({ called, presentEdrs: posture.presentEdrs });
                  })
                  .catch(err => {
                    edrMod.EdrDetection.getPresentEdrs = original;
                    callback({ _error: String(err) });
                  });
                """
            )
        finally:
            self._child_driver.set_context("content")
