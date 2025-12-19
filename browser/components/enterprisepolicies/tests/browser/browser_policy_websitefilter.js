/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

const SUPPORT_FILES_PATH =
  "http://mochi.test:8888/browser/browser/components/enterprisepolicies/tests/browser/";
const BLOCKED_PAGE = "policy_websitefilter_block.html";
const EXCEPTION_PAGE = "policy_websitefilter_exception.html";
const SAVELINKAS_PAGE = "policy_websitefilter_savelink.html";

async function clearWebsiteFilter() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: {
        Block: [],
        Exceptions: [],
      },
    },
  });
}

add_task(async function test_http() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: {
        Block: ["*://mochi.test/*policy_websitefilter_*"],
        Exceptions: ["*://mochi.test/*_websitefilter_exception*"],
      },
    },
  });

  await checkBlockedPage(SUPPORT_FILES_PATH + BLOCKED_PAGE, true);
  await checkBlockedPage(
    "view-source:" + SUPPORT_FILES_PATH + BLOCKED_PAGE,
    true
  );
  await checkBlockedPage(
    "about:reader?url=" + SUPPORT_FILES_PATH + BLOCKED_PAGE,
    true
  );
  await checkBlockedPage(
    "about:READER?url=" + SUPPORT_FILES_PATH + BLOCKED_PAGE,
    true
  );
  await checkBlockedPage(SUPPORT_FILES_PATH + EXCEPTION_PAGE, false);
  await checkBlockedPage(SUPPORT_FILES_PATH + BLOCKED_PAGE, true, {
    referrerURL: SUPPORT_FILES_PATH + EXCEPTION_PAGE,
  });

  await checkBlockedPage(SUPPORT_FILES_PATH + "301.sjs", true);

  await checkBlockedPage(SUPPORT_FILES_PATH + "302.sjs", true);
  await clearWebsiteFilter();
});

add_task(async function test_http_mixed_case() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: {
        Block: ["*://mochi.test/*policy_websitefilter_*"],
        Exceptions: ["*://mochi.test/*_websitefilter_exception*"],
      },
    },
  });

  await checkBlockedPage(SUPPORT_FILES_PATH + BLOCKED_PAGE.toUpperCase(), true);
  await checkBlockedPage(
    SUPPORT_FILES_PATH + EXCEPTION_PAGE.toUpperCase(),
    false
  );
  await clearWebsiteFilter();
});

add_task(async function test_file() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: {
        Block: ["file:///*"],
      },
    },
  });

  await checkBlockedPage("file:///this_should_be_blocked", true);
  await clearWebsiteFilter();
});

add_task(async function test_savelink() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: {
        Block: ["*://mochi.test/*policy_websitefilter_block*"],
      },
    },
  });

  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    SUPPORT_FILES_PATH + SAVELINKAS_PAGE
  );

  let contextMenu = document.getElementById("contentAreaContextMenu");
  let promiseContextMenuOpen = BrowserTestUtils.waitForEvent(
    contextMenu,
    "popupshown"
  );
  await BrowserTestUtils.synthesizeMouse(
    "#savelink_blocked",
    0,
    0,
    {
      type: "contextmenu",
      button: 2,
      centered: true,
    },
    gBrowser.selectedBrowser
  );
  await promiseContextMenuOpen;

  let saveLink = document.getElementById("context-savelink");
  is(saveLink.disabled, true, "Save Link As should be disabled");

  let promiseContextMenuHidden = BrowserTestUtils.waitForEvent(
    contextMenu,
    "popuphidden"
  );
  contextMenu.hidePopup();
  await promiseContextMenuHidden;

  promiseContextMenuOpen = BrowserTestUtils.waitForEvent(
    contextMenu,
    "popupshown"
  );
  await BrowserTestUtils.synthesizeMouse(
    "#savelink_notblocked",
    0,
    0,
    {
      type: "contextmenu",
      button: 2,
      centered: true,
    },
    gBrowser.selectedBrowser
  );
  await promiseContextMenuOpen;

  saveLink = document.getElementById("context-savelink");
  is(saveLink.disabled, false, "Save Link As should not be disabled");

  promiseContextMenuHidden = BrowserTestUtils.waitForEvent(
    contextMenu,
    "popuphidden"
  );
  contextMenu.hidePopup();
  await promiseContextMenuHidden;

  BrowserTestUtils.removeTab(tab);
  await clearWebsiteFilter();
});

add_task(async function test_http_json_policy() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: `{
        "Block": ["*://mochi.test/*policy_websitefilter_*"],
        "Exceptions": ["*://mochi.test/*_websitefilter_exception*"]
      }`,
    },
  });

  await checkBlockedPage(SUPPORT_FILES_PATH + BLOCKED_PAGE, true);
  await checkBlockedPage(
    "view-source:" + SUPPORT_FILES_PATH + BLOCKED_PAGE,
    true
  );
  await checkBlockedPage(
    "about:reader?url=" + SUPPORT_FILES_PATH + BLOCKED_PAGE,
    true
  );
  await checkBlockedPage(
    "about:READER?url=" + SUPPORT_FILES_PATH + BLOCKED_PAGE,
    true
  );
  await checkBlockedPage(SUPPORT_FILES_PATH + EXCEPTION_PAGE, false);

  await checkBlockedPage(SUPPORT_FILES_PATH + "301.sjs", true);

  await checkBlockedPage(SUPPORT_FILES_PATH + "302.sjs", true);
  await clearWebsiteFilter();
});

add_task(async function test_policy_enterprise_telemetry() {
  await setupPolicyEngineWithJson({
    policies: {
      WebsiteFilter: `{
        "Block": ["*://mochi.test/*policy_websitefilter_block*"]
      }`,
    },
  });
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

  const referrerURL = SUPPORT_FILES_PATH + SAVELINKAS_PAGE;
  await checkBlockedPageTelemetry(SUPPORT_FILES_PATH + BLOCKED_PAGE);
  await checkBlockedPageTelemetry(
    SUPPORT_FILES_PATH + BLOCKED_PAGE,
    referrerURL
  );
  await checkBlockedPageTelemetry(
    "view-source:" + SUPPORT_FILES_PATH + BLOCKED_PAGE
  );
  await checkBlockedPageTelemetry(
    "about:reader?url=" + SUPPORT_FILES_PATH + BLOCKED_PAGE
  );
  await checkBlockedPageTelemetry(
    "about:READER?url=" + SUPPORT_FILES_PATH + BLOCKED_PAGE
  );

  await checkBlockedPageTelemetry(SUPPORT_FILES_PATH + "301.sjs");
  await checkBlockedPageTelemetry(SUPPORT_FILES_PATH + "301.sjs", referrerURL);

  await checkBlockedPageTelemetry(SUPPORT_FILES_PATH + "302.sjs");
  await checkBlockedPageTelemetry(SUPPORT_FILES_PATH + "302.sjs", referrerURL);

  await clearWebsiteFilter();
});

function logStuff(message) {
  console.warn(
    "*************************************************************************************"
  );
  console.warn(message);
}

// Checks that a page was blocked by seeing if it was replaced with about:neterror
async function checkBlockedPageTelemetry(url, referrerURL) {
  logStuff("Starting test for " + url);

  logStuff("Pushed prefs");
  let newTab;
  try {
    if (referrerURL) {
      newTab = await BrowserTestUtils.openNewForegroundTab(
        gBrowser,
        referrerURL
      );

      await SpecialPowers.spawn(newTab.linkedBrowser, [url], async href => {
        let link = content.document.getElementById("savelink_blocked");
        link.href = href;
      });
      logStuff("Created new tab for referring url: " + referrerURL);
    } else {
      newTab = BrowserTestUtils.addTab(gBrowser);
      gBrowser.selectedTab = newTab;
      logStuff("Created new (blank) tab in prep for for normal url: " + url);
    }
    let browser = newTab.linkedBrowser;

    let promise = BrowserTestUtils.waitForErrorPage(browser);
    if (referrerURL) {
      await BrowserTestUtils.synthesizeMouseAtCenter(
        "#savelink_blocked",
        {},
        browser
      );
      logStuff("Clicked link in referring URL");
    } else {
      BrowserTestUtils.startLoadingURIString(browser, url);
      logStuff("Loaded normal URL");
    }
    await promise;
    logStuff("Resolved promise for error page");

    let events =
      Glean.contentPolicy.blocklistDomainBrowsed.testGetValue("enterprise");
    Assert.ok(events?.length, "Should have recorded events");
    if (!events?.length) {
      return;
    }
    Assert.greaterOrEqual(events.length, 1, "Should record at least one event"); // TODO this should eventually be exactly 1
    const event = events.at(-1);
    Assert.ok(event.extra, "Event should have extra data");
    Assert.equal(event.extra.url, url, "Telemetry should include blocked URL");
    if (referrerURL) {
      Assert.equal(
        event.extra.referrer,
        referrerURL,
        "Telemetry should include referrer URL"
      );
    }
  } finally {
    if (newTab) {
      BrowserTestUtils.removeTab(newTab);
    }
    Services.fog.testResetFOG();
  }
}
