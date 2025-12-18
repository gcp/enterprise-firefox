/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { EnterprisePolicyTesting, PoliciesPrefTracker } =
  ChromeUtils.importESModule(
    "resource://testing-common/EnterprisePolicyTesting.sys.mjs"
  );

ChromeUtils.defineESModuleGetters(this, {
  HomePage: "resource:///modules/HomePage.sys.mjs",
});

PoliciesPrefTracker.start();

async function setupPolicyEngineWithJson(json, customSchema, shutdown = false) {
  PoliciesPrefTracker.restoreDefaultValues();
  if (!Services.prefs.getBoolPref("browser.policies.testUseHttp", false)) {
    if (typeof json != "object") {
      let filePath = getTestFilePath(json ? json : "non-existing-file.json");
      return EnterprisePolicyTesting.setupPolicyEngineWithJson(
        filePath,
        customSchema
      );
    }

    if (JSON.stringify(json) === "{}") {
      json = "";
    }
    return EnterprisePolicyTesting.setupPolicyEngineWithJson(
      json,
      customSchema
    );
  }
  if (JSON.stringify(json) === "{}") {
    if (!shutdown) {
      return EnterprisePolicyTesting.servePolicyWithJson(
        {},
        {},
        registerCleanupFunction
      );
    }
    return EnterprisePolicyTesting.servePolicyWithJson({}, {});
  }
  return EnterprisePolicyTesting.servePolicyWithJson(
    json,
    customSchema || null,
    registerCleanupFunction
  );
}

function checkLockedPref(prefName, prefValue) {
  EnterprisePolicyTesting.checkPolicyPref(prefName, prefValue, true);
}

function checkUnlockedPref(prefName, prefValue) {
  EnterprisePolicyTesting.checkPolicyPref(prefName, prefValue, false);
}

// Checks that a page was blocked by seeing if it was replaced with about:neterror
async function checkBlockedPage(url, expectedBlocked, { referrerURL } = {}) {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.policies.enterprise.telemetry.testing.disableSubmit", true],
      [
        "browser.policies.enterprise.telemetry.blocklistDomainBrowsed.enabled",
        true,
      ],
      [
        "browser.policies.enterprise.telemetry.blocklistDomainBrowsed.urlLogging",
        "full",
      ],
    ],
  });

  let newTab;
  let browser;
  try {
    if (referrerURL) {
      newTab = await BrowserTestUtils.openNewForegroundTab(
        gBrowser,
        referrerURL
      );
    } else {
      newTab = BrowserTestUtils.addTab(gBrowser);
      gBrowser.selectedTab = newTab;
    }
    browser = newTab.linkedBrowser;

    if (expectedBlocked) {
      let promise = BrowserTestUtils.waitForErrorPage(browser);
      let stoppedPromise = BrowserTestUtils.browserStopped(browser);
      if (referrerURL) {
        await SpecialPowers.spawn(browser, [url], async targetURL => {
          let a = content.document.createElement("a");
          a.href = targetURL;
          content.document.body.appendChild(a);
          a.click();
        });
      } else {
        BrowserTestUtils.startLoadingURIString(browser, url);
      }
      await promise;
      await stoppedPromise;
      is(
        browser.documentURI.spec.startsWith("about:neterror?e=blockedByPolicy"),
        true,
        "Should be blocked by policy"
      );

      let events =
        Glean.contentPolicy.blocklistDomainBrowsed.testGetValue("enterprise");
      Assert.ok(events?.length, "Should have recorded events");
      if (!events?.length) {
        return;
      }
      Assert.greaterOrEqual(
        events.length,
        1,
        "Should record at least one event"
      );
      const event = events.at(-1);
      Assert.ok(event.extra, "Event should have extra data");
      Assert.ok("url" in event.extra, "Telemetry should include blocked URL");
      if (referrerURL) {
        const matching = events.filter(e => e.extra?.referrer === referrerURL);
        const recordedReferrers = events
          .map(e => e.extra?.referrer)
          .filter(Boolean)
          .join(", ");
        Assert.ok(
          matching.length,
          `Telemetry should include referrer URL (got: ${recordedReferrers})`
        );
      }
    } else {
      let promise = BrowserTestUtils.browserStopped(browser, url);
      BrowserTestUtils.startLoadingURIString(browser, url);
      await promise;

      is(browser.documentURI.spec, url, "Should not be blocked by policy");
    }
  } finally {
    if (newTab) {
      await new Promise(resolve => Services.tm.dispatchToMainThread(resolve));
      let tabClosing = BrowserTestUtils.waitForTabClosing(newTab);
      BrowserTestUtils.removeTab(newTab);
      await tabClosing;
    }
    Services.fog.testResetFOG();
    await SpecialPowers.popPrefEnv();
  }
}

async function check_homepage({
  expectedURL,
  expectedPageVal = -1,
  locked = false,
}) {
  if (expectedURL) {
    is(HomePage.get(), expectedURL, "Homepage URL should match expected");
    is(
      Services.prefs.prefIsLocked("browser.startup.homepage"),
      locked,
      "Lock status of browser.startup.homepage should match expected"
    );
  }
  if (expectedPageVal != -1) {
    is(
      Services.prefs.getIntPref("browser.startup.page", -1),
      expectedPageVal,
      "Pref page value should match expected"
    );
    is(
      Services.prefs.prefIsLocked("browser.startup.page"),
      locked,
      "Lock status of browser.startup.page should match expected"
    );
  }

  // Test that UI is disabled when the Locked property is enabled
  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:preferences"
  );
  await ContentTask.spawn(
    tab.linkedBrowser,
    { expectedURL, expectedPageVal, locked },
    // eslint-disable-next-line no-shadow
    async function ({ expectedURL, expectedPageVal, locked }) {
      if (expectedPageVal != -1) {
        // Only check restore checkbox for StartPage
        let browserRestoreSessionCheckbox = content.document.getElementById(
          "browserRestoreSession"
        );
        is(
          browserRestoreSessionCheckbox.disabled,
          locked,
          "Disabled status of session restore status should match expected"
        );
        let shouldBeChecked = expectedPageVal === 3;
        is(
          browserRestoreSessionCheckbox.checked,
          shouldBeChecked,
          "Session restore status checkbox should be: " +
            (shouldBeChecked ? "checked" : "unchecked")
        );
      }

      if (!expectedURL) {
        // If only StartPage was changed, no need to check these
        return;
      }
      await content.gotoPref("paneHome");

      let homepageTextbox = content.document.getElementById("homePageUrl");
      // Unfortunately this test does not work because the new UI does not fill
      // default values into the URL box at the moment.
      // is(homepageTextbox.value, expectedURL,
      //    "Homepage URL should match expected");

      // Wait for rendering to be finished
      await ContentTaskUtils.waitForCondition(
        () =>
          content.document.getElementById("useCurrentBtn").disabled === locked
      );

      is(
        homepageTextbox.disabled,
        locked,
        "Homepage URL text box disabled status should match expected"
      );
      is(
        content.document.getElementById("homeMode").disabled,
        locked,
        "Home mode drop down disabled status should match expected"
      );
      is(
        content.document.getElementById("useCurrentBtn").disabled,
        locked,
        '"Use current page" button disabled status should match expected'
      );
      is(
        content.document.getElementById("useBookmarkBtn").disabled,
        locked,
        '"Use bookmark" button disabled status should match expected'
      );
      is(
        content.document.getElementById("restoreDefaultHomePageBtn").disabled,
        locked,
        '"Restore defaults" button disabled status should match expected'
      );
    }
  );
  await BrowserTestUtils.removeTab(tab);
}

add_setup(async function policies_headjs_startWithCleanSlate() {
  if (Services.policies.status != Ci.nsIEnterprisePolicies.INACTIVE) {
    await setupPolicyEngineWithJson({});
  }
  is(
    Services.policies.status,
    Ci.nsIEnterprisePolicies.INACTIVE,
    "Engine is inactive at the start of the test"
  );
});

registerCleanupFunction(async function policies_headjs_finishWithCleanSlate() {
  if (Services.policies.status != Ci.nsIEnterprisePolicies.INACTIVE) {
    await setupPolicyEngineWithJson({}, {}, true);
  }
  is(
    Services.policies.status,
    Ci.nsIEnterprisePolicies.INACTIVE,
    "Engine is inactive at the end of the test"
  );

  EnterprisePolicyTesting.resetRunOnceState();
  PoliciesPrefTracker.stop();
});

function waitForAddonInstall(addonId) {
  return new Promise(resolve => {
    let listener = {
      onInstallEnded(install, addon) {
        if (addon.id == addonId) {
          AddonManager.removeInstallListener(listener);
          resolve();
        }
      },
      onDownloadFailed() {
        AddonManager.removeInstallListener(listener);
        resolve();
      },
      onInstallFailed() {
        AddonManager.removeInstallListener(listener);
        resolve();
      },
    };
    AddonManager.addInstallListener(listener);
  });
}

function waitForAddonUninstall(addonId) {
  return new Promise(resolve => {
    let listener = {};
    listener.onUninstalled = addon => {
      if (addon.id == addonId) {
        AddonManager.removeAddonListener(listener);
        resolve();
      }
    };
    AddonManager.addAddonListener(listener);
  });
}

async function testPageBlockedByPolicy(page, policyJSON) {
  if (policyJSON) {
    await EnterprisePolicyTesting.setupPolicyEngineWithJson(policyJSON);
  }
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: "about:blank" },
    async browser => {
      BrowserTestUtils.startLoadingURIString(browser, page);
      await BrowserTestUtils.browserLoaded(browser, false, page, true);
      await SpecialPowers.spawn(browser, [page], async function () {
        ok(
          content.document.documentURI.startsWith(
            "about:neterror?e=blockedByPolicy"
          ),
          content.document.documentURI +
            " should start with about:neterror?e=blockedByPolicy"
        );
      });
    }
  );
}
