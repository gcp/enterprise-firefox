/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ConsoleClient } = ChromeUtils.importESModule(
  "resource:///modules/enterprise/ConsoleClient.sys.mjs"
);
const { EnterpriseHandler } = ChromeUtils.importESModule(
  "resource:///modules/enterprise/EnterpriseHandler.sys.mjs"
);
const PROMPT_ON_SIGNOUT_PREF = "enterprise.promptOnSignout";

add_setup(function () {
  registerCleanupFunction(() => {
    EnterpriseHandler._signoutAuthorized = false;
    Services.prefs.clearUserPref(PROMPT_ON_SIGNOUT_PREF);
  });
});

add_task(async function test_shutdown_blocker_calls_signout_when_authorized() {
  let signoutCalled = false;
  let origSignoutUser = ConsoleClient.signoutUser;
  ConsoleClient.signoutUser = async () => {
    signoutCalled = true;
  };

  EnterpriseHandler._signoutAuthorized = true;
  await EnterpriseHandler._signoutOnShutdown();

  Assert.ok(
    signoutCalled,
    "ConsoleClient.signoutUser should be called when signout is authorized"
  );

  ConsoleClient.signoutUser = origSignoutUser;
  EnterpriseHandler._signoutAuthorized = false;
});

add_task(
  async function test_shutdown_blocker_skips_signout_when_not_authorized() {
    let signoutCalled = false;
    let origSignoutUser = ConsoleClient.signoutUser;
    ConsoleClient.signoutUser = async () => {
      signoutCalled = true;
    };

    EnterpriseHandler._signoutAuthorized = false;
    await EnterpriseHandler._signoutOnShutdown();

    Assert.ok(
      !signoutCalled,
      "ConsoleClient.signoutUser should not be called when not authorized"
    );

    ConsoleClient.signoutUser = origSignoutUser;
  }
);

// Note: ConsoleClient.signoutUser() guards on Services.felt.isFeltBrowser()
// which returns false in the mochitest environment even with MOZ_BYPASS_FELT=1.
// We therefore stub signoutUser to verify the blocker invokes it and tokens
// are cleared, rather than testing the actual HTTP POST to /sso/logout.
add_task(
  async function test_shutdown_blocker_invokes_signout_and_clears_tokens() {
    // Set up tokens to verify they get cleared
    let expiresAt = Math.floor(Date.now() / 1000) + 3600;
    Services.felt.setTokens(
      "test-access-token",
      "test-refresh-token",
      expiresAt
    );

    let signoutCalled = false;
    let origSignoutUser = ConsoleClient.signoutUser;
    ConsoleClient.signoutUser = async function () {
      signoutCalled = true;
      this.clearTokenData();
    };

    EnterpriseHandler._signoutAuthorized = true;
    await EnterpriseHandler._signoutOnShutdown();

    Assert.ok(signoutCalled, "signoutUser should be called by the blocker");
    Assert.ok(
      !Services.felt.getAccessTokenIfValid(),
      "Access token should be cleared after signout"
    );
    Assert.ok(
      !Services.felt.getRefreshToken(),
      "Refresh token should be cleared after signout"
    );

    ConsoleClient.signoutUser = origSignoutUser;
    EnterpriseHandler._signoutAuthorized = false;
  }
);

add_task(
  async function test_showSignoutPrompt_skips_dialog_when_pref_disabled() {
    Services.prefs.setBoolPref(PROMPT_ON_SIGNOUT_PREF, false);
    EnterpriseHandler._signoutAuthorized = false;

    let result = EnterpriseHandler.showSignoutPrompt(window);

    Assert.ok(result, "Should return true when prompt pref is disabled");

    Services.prefs.clearUserPref(PROMPT_ON_SIGNOUT_PREF);
  }
);

