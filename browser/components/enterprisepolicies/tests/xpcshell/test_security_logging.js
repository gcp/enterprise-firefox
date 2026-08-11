/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const SECURITY_LOGGING_PREFS = {
  "browser.policies.enterprise.telemetry.blocklistDomainBrowsed.enabled": true,
  "browser.policies.enterprise.telemetry.blocklistDomainBrowsed.urlLogging":
    "domain",
  "browser.download.enterprise.telemetry.enabled": true,
  "browser.download.enterprise.telemetry.urlLogging": "full",
  "browser.download.enterprise.telemetry.fileLogging": "metadata",
  "print.enterprise.telemetry.printPage.enabled": false,
  "print.enterprise.telemetry.printPage.urlLogging": "none",
  "browser.safebrowsing.enterprise.telemetry.unsafeDownload.enabled": true,
  "browser.safebrowsing.enterprise.telemetry.unsafeDownload.urlLogging":
    "domain",
  "browser.safebrowsing.enterprise.telemetry.unsafeSiteVisit.enabled": true,
  "browser.safebrowsing.enterprise.telemetry.unsafeSiteVisit.urlLogging":
    "full",
};

function lockPrefElsewhere(prefName, prefValue) {
  const defaults = Services.prefs.getDefaultBranch("");
  if (typeof prefValue === "boolean") {
    defaults.setBoolPref(prefName, prefValue);
  } else {
    defaults.setStringPref(prefName, prefValue);
  }
  Services.prefs.lockPref(prefName);
}

function clearPrefLockedElsewhere(prefName) {
  Services.prefs.unlockPref(prefName);
  Services.prefs.getDefaultBranch("").deleteBranch(prefName);
}

add_task(async function test_all_events_configured_through_policy_engine() {
  await setupPolicyEngineWithJson({
    policies: {
      SecurityLogging: {
        BlocklistDomainBrowsed: { Enabled: true, UrlLogging: "domain" },
        Download: {
          Enabled: true,
          UrlLogging: "full",
          FileLogging: "metadata",
        },
        PrintPage: { Enabled: false, UrlLogging: "none" },
        UnsafeDownload: { Enabled: true, UrlLogging: "domain" },
        UnsafeSiteVisit: { Enabled: true, UrlLogging: "full" },
      },
    },
  });

  for (const [pref, value] of Object.entries(SECURITY_LOGGING_PREFS)) {
    checkLockedPref(pref, value);
  }

  await setupPolicyEngineWithJson("");

  for (const pref of Object.keys(SECURITY_LOGGING_PREFS)) {
    checkUnsetPref(pref);
  }
});

add_task(async function test_unmentioned_settings_are_untouched() {
  const externalPref = "print.enterprise.telemetry.printPage.enabled";
  const downloadPref = "browser.download.enterprise.telemetry.enabled";
  lockPrefElsewhere(externalPref, true);

  try {
    await setupPolicyEngineWithJson({
      policies: {
        SecurityLogging: { Download: { Enabled: true } },
      },
    });

    checkLockedPref(downloadPref, true);
    checkLockedPref(externalPref, true);

    await setupPolicyEngineWithJson("");

    checkUnsetPref(downloadPref);
    checkLockedPref(externalPref, true);
  } finally {
    clearPrefLockedElsewhere(externalPref);
  }
});
