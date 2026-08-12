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

    # A second descriptor, to check that a descriptor arriving mid-session
    # replaces the one the browser was launched with. Distinct lists again.
    UPDATED_POSTURE_ELEMENTS = {
        "Windows_NT": {"edr": ["sentinelone"]},
        "Darwin": {"edr": ["sentinelone", "cortex-xdr"]},
        "Linux": {"edr": ["cortex-xdr"]},
    }

    def expected_edr(self, posture_elements):
        """The section the client should have selected out of posture_elements.
        Reads the key back from the browser so the test resolves it through the
        product's own source of truth, and requires that the reported OS name has
        a section."""
        self._child_driver.set_context("chrome")
        try:
            os_name = self._child_driver.execute_script(
                "return Services.sysinfo.getProperty('name');"
            )
        finally:
            self._child_driver.set_context("content")
        assert os_name in posture_elements, (
            f"reported OS name {os_name!r} has no posture_elements section; "
            f"known sections: {sorted(posture_elements)}"
        )
        return posture_elements[os_name]["edr"]

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
        # Runs last: it replaces the descriptor the console serves.
        self.run_mid_session_descriptor_reaches_browser()

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
        assert json.loads(edr_pref) == self.expected_edr(self.POSTURE_ELEMENTS), (
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
        assert rv["recorded"] == self.expected_edr(self.POSTURE_ELEMENTS), (
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

    def run_mid_session_descriptor_reaches_browser(self):
        """A descriptor delivered after the browser started reaches it too, so
        both processes collect posture from the same probe list."""
        expected = self.expected_edr(self.UPDATED_POSTURE_ELEMENTS)
        self.config_posture_elements.value = json.dumps(
            self.UPDATED_POSTURE_ELEMENTS, separators=(",", ":")
        )

        # Have the browser ask Felt for a token refresh: the console folds the
        # descriptor it currently serves into that response. A refresh that was
        # already in flight carries the previous descriptor, so keep asking
        # (roughly every 20th poll, to leave each attempt time to complete).
        polls = 0

        def refreshed(_):
            nonlocal polls
            if polls % 20 == 0:
                self._child_driver.execute_script("Services.felt.refreshTokens();")
            polls += 1
            value = self._child_driver.execute_script(
                "return Services.prefs.getStringPref("
                "'enterprise.posture.edr_agents', '');"
            )
            return value if value and json.loads(value) == expected else None

        self._child_driver.set_context("chrome")
        try:
            edr_pref = self._child_longwait.until(refreshed)
        finally:
            self._child_driver.set_context("content")

        assert json.loads(edr_pref) == expected, (
            "the mid-session descriptor replaced the launch-time probe list, got "
            f"{edr_pref}"
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

    # A minimal on-disk add-on database, in the shape XPIDatabase serializes:
    # an active and a disabled add-on that posture reports, plus an invisible
    # add-on and a type it does not report. The active one is translated into a
    # locale posture does not report in, the disabled one into the locale it does.
    ADDON_DB = {
        "schemaVersion": 36,
        "addons": [
            {
                "id": "active@example.com",
                "type": "extension",
                "version": "1.2",
                "visible": True,
                "active": True,
                "defaultLocale": {"name": "Active Extension"},
                "locales": [{"locales": ["de"], "name": "Aktive Erweiterung"}],
            },
            {
                "id": "disabled@example.com",
                "type": "extension",
                "version": "0.9",
                "visible": True,
                "active": False,
                "defaultLocale": {"name": "Deaktivierte Erweiterung"},
                "locales": [{"locales": ["en-US"], "name": "Disabled Extension"}],
            },
            {
                "id": "invisible@example.com",
                "type": "extension",
                "version": "3.0",
                "visible": False,
                "active": True,
                "defaultLocale": {"name": "Invisible Extension"},
                "locales": [],
            },
            {
                "id": "theme@example.com",
                "type": "theme",
                "version": "1.0",
                "visible": True,
                "active": True,
                "defaultLocale": {"name": "A Theme"},
                "locales": [],
            },
        ],
    }

    def test_felt_reads_the_addon_db_without_writing_it(self):
        """Felt reports the launching profile's add-ons from its on-disk database,
        and the read leaves that database byte-identical."""
        # FELT-only test (see test_profile_derivation_from_user_id): getExtensions
        # takes the isFeltUI() on-disk path, so no login/child browser is needed.
        self._manually_closed_child = True
        rv = self._collect_with_addon_db(json.dumps(self.ADDON_DB))
        assert "_error" not in rv, f"DevicePosture.collect threw: {rv.get('_error')}"
        assert isinstance(rv["extensions"], list), (
            f"the add-on list was read, got {rv['extensions']!r}"
        )

        reported = {addon["id"]: addon for addon in rv["extensions"]}
        assert set(reported) == {"active@example.com", "disabled@example.com"}, (
            "only visible add-ons of a reported type are reported, got "
            f"{sorted(reported)}"
        )
        assert reported["active@example.com"] == {
            "id": "active@example.com",
            "name": "Active Extension",
            "type": "extension",
            "version": "1.2",
            "enabled": True,
        }, (
            "the reported fields match the database, falling back to the add-on's "
            f"default locale, got {reported}"
        )
        assert reported["disabled@example.com"]["name"] == "Disabled Extension", (
            "an add-on translated into en-US is reported under that name, got "
            f"{reported['disabled@example.com']['name']!r}"
        )
        assert reported["disabled@example.com"]["enabled"] is False, (
            "an inactive add-on is reported as disabled"
        )
        self._assert_addon_db_untouched(rv)

    def test_posture_without_an_addon_db(self):
        """A profile that has never been launched has no add-on database yet:
        posture reports the list as unknown rather than inventing one on disk."""
        self._manually_closed_child = True
        rv = self._collect_with_addon_db(None)
        assert "_error" not in rv, f"DevicePosture.collect threw: {rv.get('_error')}"
        assert rv["extensions"] is None, (
            f"extensions is unknown without a database, got {rv['extensions']!r}"
        )
        assert rv["hasOs"], "the rest of the posture is still collected"
        assert rv["dbAfter"] is None, "no add-on database is created for the profile"
        self._assert_addon_db_untouched(rv)

    def test_posture_survives_unreadable_addon_db(self):
        """A malformed on-disk add-on database must not break posture collection:
        extensions degrades to null/empty and the rest is still reported."""
        self._manually_closed_child = True
        rv = self._collect_with_addon_db("{ this is not valid json")
        assert "_error" not in rv, (
            f"DevicePosture.collect threw on a malformed add-on DB: {rv.get('_error')}"
        )
        assert rv["extensions"] is None or isinstance(rv["extensions"], list), (
            f"extensions degrades gracefully, got {rv['extensions']!r}"
        )
        assert rv["hasOs"], "the rest of the posture is still collected"
        self._assert_addon_db_untouched(rv)

    def _assert_addon_db_untouched(self, rv):
        assert rv["dbAfter"] == rv["dbBefore"], (
            "the launching profile's add-on database is left byte-identical"
        )

    def _collect_with_addon_db(self, extensions_json):
        """Collects posture against a scratch profile directory holding
        extensions_json, or holding no database at all when it is None."""
        self._driver.set_context("chrome")
        try:
            return self._driver.execute_async_script(
                """
                const dbJson = arguments[0];
                const callback = arguments[arguments.length - 1];
                (async () => {
                  const dir = PathUtils.join(PathUtils.tempDir, "felt-posture-addondb");
                  const dbPath = PathUtils.join(dir, "extensions.json");
                  const readOrNull = async path =>
                    (await IOUtils.exists(path)) ? IOUtils.readUTF8(path) : null;
                  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
                  if (dbJson !== null) {
                    await IOUtils.writeUTF8(dbPath, dbJson);
                  }
                  const { DevicePosture } = ChromeUtils.importESModule(
                    "resource://gre/modules/enterprise/DevicePosture.sys.mjs"
                  );
                  const dbBefore = await readOrNull(dbPath);
                  try {
                    const posture = await DevicePosture.collect({
                      profileDir: dir,
                    });
                    return {
                      extensions: posture.extensions,
                      hasOs: !!(posture.os && posture.os.name),
                      dbBefore,
                      dbAfter: await readOrNull(dbPath),
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
