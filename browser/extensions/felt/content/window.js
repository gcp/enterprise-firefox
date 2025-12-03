/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { E10SUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/E10SUtils.sys.mjs"
);

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ConsoleClient: "resource:///modules/enterprise/ConsoleClient.sys.mjs",
  FeltCommon: "chrome://felt/content/FeltCommon.sys.mjs",
  FeltStorage: "resource:///modules/FeltStorage.sys.mjs",
});

// Will at least make move forward marionette
Services.obs.notifyObservers(window, "browser-delayed-startup-finished");

async function connectToConsole(email) {
  const posture = await lazy.ConsoleClient.sendDevicePosture();
  if (!posture) {
    // TODO: Currently we don't check the posture yet. In the future we need to handle rejected device posture
    return;
  }

  let browser = document.getElementById("browser");

  let oa = E10SUtils.predictOriginAttributes({ browser });
  browser.setAttribute("maychangeremoteness", "true");

  const ssoLoginURI = lazy.ConsoleClient.constructSsoLoginURI(
    email,
    posture.posture
  );

  browser.setAttribute(
    "remoteType",
    E10SUtils.getRemoteTypeForURI(
      ssoLoginURI.spec,
      /* remote */ true,
      /* fission */ true,
      E10SUtils.WEB_REMOTE_TYPE,
      null,
      oa
    )
  );
  console.debug(
    `FeltExtension: creating contentPrincipal with privateBrowsingId=${lazy.FeltCommon.PRIVATE_BROWSING_ID}`
  );
  const contentPrincipal =
    Services.scriptSecurityManager.createContentPrincipal(ssoLoginURI, {
      privateBrowsingId: lazy.FeltCommon.PRIVATE_BROWSING_ID,
    });
  console.debug(
    `FeltExtension: created contentPrincipal with privateBrowsingId=${contentPrincipal.privateBrowsingId}`
  );
  console.debug("Load SSO URI: ", ssoLoginURI);
  browser.fixupAndLoadURIString(ssoLoginURI.spec, {
    triggeringPrincipal: contentPrincipal,
  });

  document.querySelector(".felt-login__email-pane").classList.add("is-hidden");
  document.querySelector(".felt-login__sso").classList.remove("is-hidden");

  const ssoBrowsingContext = document.querySelector("browser");
  ssoBrowsingContext.focus();
}

async function listenFormEmailSubmission() {
  const signInBtn = document.getElementById("felt-form__sign-in-btn");
  const emailInput = document.getElementById("felt-form__email");

  const lastUsedUserEmail = lazy.FeltStorage.getLastSignedInUser();
  if (lastUsedUserEmail) {
    emailInput.value = lastUsedUserEmail;
    signInBtn.disabled = false;
  }

  emailInput.addEventListener("input", () => {
    signInBtn.disabled = emailInput.value.trim() === "";
  });

  // <moz-button> does not trigger the native "submit" event on <form>
  // so we manually handle submission on button click and when Enter is pressed
  signInBtn.addEventListener("click", () => {
    connectToConsole(emailInput.value);
  });
  emailInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !signInBtn.disabled) {
      e.preventDefault();
      connectToConsole(emailInput.value);
    }
  });
}

function setupMarionetteEnvironment() {
  window.gBrowser = {
    get selectedBrowser() {
      let rv = document.getElementById("browser");
      return rv;
    },

    get tabs() {
      let ts = [
        {
          linkedBrowser: this.selectedBrowser,
        },
      ];
      return ts;
    },

    get selectedTab() {
      return this.tabs[0];
    },

    set selectedTab(tab) {
      // Synthesize a custom TabSelect event to indicate that a tab has been
      // selected even when we don't change it.
      const event = new window.CustomEvent("TabSelect", {
        bubbles: true,
        cancelable: false,
        detail: {
          previousTab: this.selectedTab,
        },
      });

      window.document.dispatchEvent(event);
    },

    getTabForBrowser() {
      return window;
    },

    addEventListener() {
      this.selectedBrowser.addEventListener(...arguments);
    },

    removeEventListener() {
      this.selectedBrowser.removeEventListener(...arguments);
    },
  };

  // Last notification required for marionette to work
  Services.obs.notifyObservers(window, "browser-idle-startup-tasks-finished");
}

window.addEventListener(
  "load",
  () => {
    setupMarionetteEnvironment();
    listenFormEmailSubmission();
  },
  true
);
