#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import json
import os
import sys

sys.path.append(os.path.dirname(__file__))

import requests
from felt_tests import FeltTests


class FeltDevicePostureElements(FeltTests):
    """The console drives which EDR agents device posture probes.

    The console publishes one global, platform-keyed `posture_elements`
    descriptor in the browser config; Felt selects the section for the platform
    it is running on, stores it into the enterprise.posture.* prefs, and
    DevicePosture.collect probes exactly that list, probing nothing when the
    prefs are unset. Each section is also expected to carry a parallel osquery
    query list, but osquery collection is not implemented yet, so it is not
    exercised here.
    """

    # Keyed by the OS name the client reports in the posture payload
    # (sysinfo "name" / PR_SI_SYSNAME), with a distinct list per platform so a
    # wrong selection shows up as a mismatch.
    POSTURE_ELEMENTS = {
        "Windows_NT": {"edr": ["crowdstrike", "cortex-xdr"]},
        "Darwin": {"edr": ["crowdstrike"]},
        "Linux": {"edr": ["sentinelone"]},
    }

    @property
    def expected_edr(self):
        """The section the client should have selected. Reads the key back from
        the browser so the test resolves it through the product's own source of
        truth, and requires that the reported OS name has a section."""
        self._child_driver.set_context("chrome")
        try:
            os_name = self._child_driver.execute_script(
                "return Services.sysinfo.getProperty('name');"
            )
        finally:
            self._child_driver.set_context("content")
        assert os_name in self.POSTURE_ELEMENTS, (
            f"reported OS name {os_name!r} has no posture_elements section; "
            f"known sections: {sorted(self.POSTURE_ELEMENTS)}"
        )
        return self.POSTURE_ELEMENTS[os_name]["edr"]

    def test_posture_elements(self):
        # The config is fetched before the child browser starts, so the console
        # must serve posture_elements before run_felt_base().
        self.config_posture_elements.value = json.dumps(
            self.POSTURE_ELEMENTS, separators=(",", ":")
        )
        super().run_felt_base()
        self.connect_child_browser()

        self.run_os_version_not_sent_to_sso()
        self.run_config_pref_plumbing()
        self.run_console_driven_probes()
        self.run_probe_none_when_unconfigured()

    def run_os_version_not_sent_to_sso(self):
        """Platform selection happens on the client, so the login request
        identifies only the user and the device."""
        console_addr = f"http://localhost:{self.console_port}"
        r = requests.get(f"{console_addr}/sso/get_sso_os_version")
        os_version = r.json()
        assert os_version is None, (
            f"SSO login must not carry an osVersion, got {os_version!r}"
        )

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
        """This platform's section of posture_elements is pushed to the browser as
        JSON prefs; the other platforms' sections are not."""
        edr_pref = self._wait_for_string_pref("enterprise.posture.edr_agents")
        assert json.loads(edr_pref) == self.expected_edr, (
            "edr_agents pref reflects this platform's section of the console "
            f"config, got {edr_pref}"
        )

    def run_console_driven_probes(self):
        """DevicePosture.collect probes exactly the console-configured EDR list."""
        self._child_driver.set_context("chrome")
        try:
            rv = self._child_driver.execute_async_script(
                """
                const callback = arguments[arguments.length - 1];
                const edrMod = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/EdrDetection.sys.mjs"
                );
                const { DevicePosture } = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/DevicePosture.sys.mjs"
                );
                // Spy on getPresentEdrs so we can assert which agents were
                // requested without depending on what is installed on the host.
                const original = edrMod.EdrDetection.getPresentEdrs;
                let recorded = null;
                edrMod.EdrDetection.getPresentEdrs = ids => {
                  recorded = ids;
                  return Promise.resolve([]);
                };
                DevicePosture.collect()
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

        assert "_error" not in rv, f"DevicePosture.collect threw: {rv.get('_error')}"
        assert rv["recorded"] == self.expected_edr, (
            "getPresentEdrs called with this platform's console-configured list, "
            f"got {rv['recorded']}"
        )

    def run_probe_none_when_unconfigured(self):
        """With no EDR configured, getPresentEdrs is never called (an empty list
        would otherwise mean 'probe every known agent')."""
        # Both an explicit empty list and an absent/cleared pref must probe none.
        for edr_pref_value in ["[]", None]:
            rv = self._collect_with_edr_spy(edr_pref_value)
            assert "_error" not in rv, (
                f"DevicePosture.collect threw: {rv.get('_error')}"
            )
            assert rv["called"] is False, (
                "getPresentEdrs must not be called when no EDR is configured "
                f"(edr_agents={edr_pref_value!r})"
            )
            assert rv["presentEdrs"] == [], (
                f"presentEdrs is empty when no EDR configured, got {rv['presentEdrs']}"
            )

    def test_profile_derivation_from_user_id(self):
        """A distinct user id derives a stable, per-user managed profile name;
        the same id derives the same name (so getProfilePath reuses one profile)
        and a missing id falls back to the shared base.

        Every other test pins enterprise.profile_path, which bypasses this
        derivation entirely. We test the pure getProfileName mapping directly to
        avoid getProfilePath's profile-creation side effect on the real profile
        registry.
        """
        # FELT-only test: getProfileName lives in chrome://felt, so run against
        # the login-window chrome context that setUp already established. We do
        # not log in and never launch a child browser, so tell teardown not to
        # expect one.
        self._manually_closed_child = True
        rv = self._derive_profile_names(["felt-user-alpha", "felt-user-beta"])
        assert "_error" not in rv, f"getProfileName threw: {rv.get('_error')}"

        base, alpha1, beta, alpha2, fallback = (
            rv["base"],
            rv["alpha1"],
            rv["beta"],
            rv["alpha2"],
            rv["fallback"],
        )
        assert alpha1 and beta, "derivation returned profile names"
        assert alpha1.startswith(f"{base}-"), (
            f"derived profile name is under the shared base, got {alpha1}"
        )
        assert beta.startswith(f"{base}-"), (
            f"derived profile name is under the shared base, got {beta}"
        )
        assert alpha1 != base, "a user id must derive more than the bare base name"
        assert alpha1 != beta, "distinct user ids derive distinct profiles"
        assert alpha1 == alpha2, "the same user id derives the same profile"
        assert fallback == base, "a missing user id falls back to the shared base"

    def _derive_profile_names(self, user_ids):
        self._driver.set_context("chrome")
        try:
            return self._driver.execute_async_script(
                """
                const [alphaId, betaId] = arguments[0];
                const callback = arguments[arguments.length - 1];
                (async () => {
                  const { getProfileName } = ChromeUtils.importESModule(
                    "chrome://felt/content/FeltCommon.sys.mjs"
                  );
                  const { AppConstants } = ChromeUtils.importESModule(
                    "resource://gre/modules/AppConstants.sys.mjs"
                  );
                  return {
                    alpha1: await getProfileName(alphaId),
                    beta: await getProfileName(betaId),
                    alpha2: await getProfileName(alphaId),
                    fallback: await getProfileName(null),
                    base: `enterprise-profile-${AppConstants.MOZ_UPDATE_CHANNEL}`,
                  };
                })().then(callback, err => callback({ _error: String(err) }));
                """,
                [user_ids],
            )
        finally:
            self._driver.set_context("content")

    def test_posture_survives_unreadable_addon_db(self):
        """A malformed on-disk add-on database must not break posture collection:
        extensions degrades to null/empty and the rest is still reported."""
        # FELT-only test (see test_profile_derivation_from_user_id): getExtensions
        # takes the isFeltUI() on-disk path, so no login/child browser is needed.
        self._manually_closed_child = True
        rv = self._collect_with_addon_db("{ this is not valid json")
        assert "_error" not in rv, (
            f"DevicePosture.collect threw on a malformed add-on DB: {rv.get('_error')}"
        )
        assert rv["extensions"] is None or isinstance(rv["extensions"], list), (
            f"extensions degrades gracefully, got {rv['extensions']!r}"
        )
        assert rv["hasOs"], "the rest of the posture is still collected"

    def _collect_with_addon_db(self, extensions_json):
        self._driver.set_context("chrome")
        try:
            return self._driver.execute_async_script(
                """
                const badJson = arguments[0];
                const callback = arguments[arguments.length - 1];
                (async () => {
                  const dir = PathUtils.join(PathUtils.tempDir, "felt-posture-baddb");
                  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
                  await IOUtils.writeUTF8(
                    PathUtils.join(dir, "extensions.json"), badJson
                  );
                  const { DevicePosture } = ChromeUtils.importESModule(
                    "resource://gre/modules/enterprise/DevicePosture.sys.mjs"
                  );
                  try {
                    const posture = await DevicePosture.collect({
                      profileDir: dir,
                    });
                    return {
                      extensions: posture.extensions,
                      hasOs: !!(posture.os && posture.os.name),
                    };
                  } finally {
                    await IOUtils.remove(dir, { recursive: true });
                  }
                })().then(callback, err => callback({ _error: String(err) }));
                """,
                [extensions_json],
            )
        finally:
            self._driver.set_context("content")

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
                const { DevicePosture } = ChromeUtils.importESModule(
                  "resource://gre/modules/enterprise/DevicePosture.sys.mjs"
                );
                const original = edrMod.EdrDetection.getPresentEdrs;
                let called = false;
                edrMod.EdrDetection.getPresentEdrs = ids => {
                  called = true;
                  return original(ids);
                };
                DevicePosture.collect()
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
