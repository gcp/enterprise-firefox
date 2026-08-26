/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { EnterprisePolicyTesting, PoliciesPrefTracker } =
  ChromeUtils.importESModule(
    "resource://testing-common/EnterprisePolicyTesting.sys.mjs"
  );

const PREF_ENABLED = "extensions.enterprise.telemetry.addonInstall.enabled";
const PREF_DISABLE_SUBMIT =
  "extensions.enterprise.telemetry.testing.disableSubmit";

async function installExtension(id) {
  Services.fog.testResetFOG();
  const extension = ExtensionTestUtils.loadExtension({
    manifest: {
      browser_specific_settings: { gecko: { id } },
    },
    useAddonManager: "permanent",
    amInstallTelemetryInfo: {
      source: "about:addons",
      method: "install-from-file",
    },
  });

  await extension.startup();
  const events = Glean.addonsManager.installComplete.testGetValue("enterprise");
  await extension.unload();
  return events;
}

add_setup(async function () {
  do_get_profile();
  Services.fog.initializeFOG();
  Services.prefs.setBoolPref(PREF_DISABLE_SUBMIT, true);
  Services.policies; // eslint-disable-line no-unused-expressions
  PoliciesPrefTracker.start();
  createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "1", "1.9.2");
  await promiseStartupManager();

  registerCleanupFunction(async () => {
    await EnterprisePolicyTesting.setupPolicyEngineWithJson("");
    Services.prefs.clearUserPref(PREF_DISABLE_SUBMIT);
    PoliciesPrefTracker.stop();
    await promiseShutdownManager();
  });
});

add_task(async function test_addon_install_telemetry_policy() {
  await EnterprisePolicyTesting.setupPolicyEngineWithJson({
    policies: {
      SecurityLogging: { AddonInstall: { Enabled: true } },
    },
  });

  EnterprisePolicyTesting.checkPolicyPref(PREF_ENABLED, true, true);
  let events = await installExtension("enabled@example.com");
  Assert.equal(events?.length, 1, "the enabled policy records an installation");

  await EnterprisePolicyTesting.setupPolicyEngineWithJson({
    policies: {
      SecurityLogging: { AddonInstall: { Enabled: false } },
    },
  });

  EnterprisePolicyTesting.checkPolicyPref(PREF_ENABLED, false, true);
  events = await installExtension("disabled@example.com");
  Assert.ok(
    !events?.length,
    "the disabled policy suppresses installation telemetry"
  );

  await EnterprisePolicyTesting.setupPolicyEngineWithJson("");

  Assert.ok(
    !Services.prefs.prefIsLocked(PREF_ENABLED),
    "the preference is unlocked"
  );
  events = await installExtension("default@example.com");
  Assert.equal(events?.length, 1, "removing the policy restores collection");
});
