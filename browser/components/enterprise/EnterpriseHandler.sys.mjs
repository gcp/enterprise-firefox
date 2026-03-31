/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "localization", () => {
  return new Localization(
    ["browser/enterprise/enterprise.ftl", "branding/brand.ftl"],
    true
  );
});

ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  ConsoleClient: "resource:///modules/enterprise/ConsoleClient.sys.mjs",
  EnterpriseCommon: "resource:///modules/enterprise/EnterpriseCommon.sys.mjs",
  isTesting: "resource:///modules/enterprise/EnterpriseCommon.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return console.createInstance({
    prefix: "EnterpriseHandler",
    maxLogLevelPref: lazy.EnterpriseCommon.ENTERPRISE_LOGLEVEL_PREF,
  });
});

const PROMPT_ON_SIGNOUT_PREF = "enterprise.promptOnSignout";
const COMPANY_LOGO_URL_PREF = "enterprise.configs.company_logo_url";
const LEARN_MORE_URL_PREF = "enterprise.configs.learn_more_url";

/**
 * Parses a given url string
 *
 * @param {string} url url string from preference
 * @returns {URL|null} A parsed `URL` object if it's valid, otherwise `null`.
 */
function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    lazy.log.error(`Invalid URL: ${url}`);
    return null;
  }
}

/**
 * Validate that the URL is HTTPS and hosted on the console host.
 *
 * @param {string} url - The URL string to validate.
 * @returns {URL|null} A parsed `URL` object if validation succeeds, otherwise `null`.
 */
function validateHttpsConsoleUrl(url) {
  const parsedUrl = parseUrl(url);

  if (!parsedUrl) {
    return null;
  }

  const isLocalTest =
    lazy.isTesting() &&
    (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1");

  if (parsedUrl.protocol !== "https:" && !isLocalTest) {
    lazy.log.warn(`Expected HTTPS URL: ${url}`);
    return null;
  }
  if (parsedUrl.hostname !== lazy.ConsoleClient.consoleBaseURI.hostname) {
    lazy.log.warn(`Expected URL hosted by the console origin: ${url}`);
    return null;
  }

  return parsedUrl;
}

/**
 * Validates that a URL string is a base64-encoded data URL for a supported image type.
 *
 * Supported MIME types are PNG, JPEG, GIF, WebP, and SVG.
 *
 * If validation fails, an error is logged and `null` is returned.
 *
 * @param {string} url - The URL string to validate.
 * @returns {URL|null} A parsed `URL` object if validation succeeds, otherwise `null`.
 */
function validateDataUrl(url) {
  const parsedUrl = parseUrl(url);

  if (!parsedUrl) {
    return null;
  }

  const isSupportedImageDataUrl =
    parsedUrl.protocol === "data:" &&
    /^image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/.test(parsedUrl.pathname);

  if (!isSupportedImageDataUrl) {
    lazy.log.error(
      `Expected a base64-encoded supported image data URL: ${url}`
    );
    return null;
  }
  return parsedUrl;
}

export const EnterpriseHandler = {
  /**
   * @type {{name:string, email:string, pictureUrl:string} | null}
   */
  _signedInUser: null,

  /**
   * Whether the handler is initialized, meaning the user information
   * from the signed in user has been received from the console.
   */
  _isInitialized: false,

  /**
   * Whether the panel has been opened once,
   * which populates the learn more link
   */
  _isLearnMoreLinkConfigured: false,

  /**
   * Set to true when signout has been explicitly authorized (user confirmed
   * the prompt, or promptOnSignout is false). Gates the appShutdownConfirmed
   * blocker so that unrelated quits do not trigger a signout.
   */
  _signoutAuthorized: false,

  /**
   * Handles the enterprise state for each new browser window.
   * On first call:
   *    - Make a request to the console to retrieve the user information of the signed in user.
   * On every call:
   *    - Hide FxA toolbar button and FxA item in app menu (hamburger menu)
   *
   * @param {Window} window chrome window
   */
  async init(window) {
    if (Services.felt.isFeltUI()) {
      // Nothing to setup for the felt window
      return;
    }
    if (!this._isInitialized) {
      lazy.log.debug("Initializing...");
      await this.initUser();
      this.registerSignoutBlocker();
      this._isInitialized = true;
    }
    this.updateBadge(window);
    this.restrictEnterpriseView(window);
    this._initLockdownModeButton(window);
  },

  async initUser() {
    try {
      const { name, email, picture } =
        await lazy.ConsoleClient.getLoggedInUserInfo();
      this._signedInUser = { name, email, pictureUrl: picture };
    } catch (e) {
      // TODO: Bug 2000864 - Handle unsuccessful GET /WHOAMI
      console.warn(
        "EnterpriseHandler: Unable to initialize enterprise user: ",
        e
      );
    }
  },

  _initLockdownModeButton(window) {
    const button = window.document.getElementById("lockdown-mode-button");

    button.addEventListener("click", event => {
      window.PanelUI.showSubView("panelUI-lockdown-mode", button, event);
    });

    window.gBrowser.addProgressListener({
      onLocationChange(webProgress, _request, location) {
        if (!webProgress.isTopLevel) {
          return;
        }
        let isLockedDown = false;
        try {
          isLockedDown = !Services.policies.isAllowedForURI("jit", location);
        } catch (e) {
          lazy.log.warn("Failed to check lockdown state for URI: ", e);
        }
        button.hidden = !isLockedDown;
      },
    });
  },

  registerSignoutBlocker() {
    if (Services.felt.isFeltBrowser()) {
      lazy.AsyncShutdown.appShutdownConfirmed.addBlocker(
        "EnterpriseHandler: signing out user on shutdown",
        () => this._signoutOnShutdown()
      );
    }
  },

  /**
   * Updates the user icon and badge logo
   *
   * @param {Window} window chrome window
   */
  updateBadge(window) {
    this._updateLogo(window);

    const userIcon = window.document.querySelector("#enterprise-user-icon");

    if (!this._signedInUser) {
      // Hide user icon from enterprise badge until we have user information
      userIcon.hidden = true;
      console.warn(
        "Unable to update user icon in badge without user information"
      );
      return;
    }
    userIcon.style.setProperty(
      "list-style-image",
      `url("${this._signedInUser.pictureUrl}")`
    );
  },

  /**
   * Retrieves, validates, and applies the learn more URL to the link element.
   * Leaves the link unconfigured if missing or invalid.
   *
   * @param {Window} win - chrome window
   * @returns {void}
   */
  _setupLearnMoreLink(win) {
    const learnMoreUrl = Services.prefs.getStringPref(LEARN_MORE_URL_PREF);

    if (!learnMoreUrl) {
      lazy.log.warn("No learn more url available.");
      return;
    }

    const validLearnMoreUrl = validateHttpsConsoleUrl(learnMoreUrl);

    if (validLearnMoreUrl !== null) {
      lazy.log.debug(`Setting learn more uri to ${validLearnMoreUrl.href}`);
      const document = win.document;
      const learnMoreLink = document.getElementById(
        "enterprise-learn-more-link"
      );
      learnMoreLink.setAttribute("href", validLearnMoreUrl.href);
      this._isLearnMoreLinkConfigured = true;

      learnMoreLink.addEventListener("click", e => {
        let where = lazy.BrowserUtils.whereToOpenLink(e, false, false);
        if (where == "current") {
          where = "tab";
        }
        win.openTrustedLinkIn(validLearnMoreUrl.href, where);
        e.preventDefault();

        const panel = document
          .getElementById("panelUI-enterprise")
          .closest("panel");
        win.PanelMultiView.hidePopup(panel);
      });
    }
  },

  openPanel(element, event) {
    const win = element.ownerGlobal;
    win.PanelUI.showSubView("panelUI-enterprise", element, event);
    const document = element.ownerDocument;

    if (!this._isLearnMoreLinkConfigured) {
      this._setupLearnMoreLink(win);
    }

    const email = document.querySelector(".panelUI-enterprise__email");
    if (!this._signedInUser) {
      email.hidden = true;
      document.querySelector("#PanelUI-enterprise-email-separator").hidden =
        true;
      console.warn(
        "Unable to update email in enterprise panel without user information"
      );
      return;
    }

    if (!email.textContent) {
      email.textContent = this._signedInUser.email;
    }
  },

  /**
   * Hide away FxA appearances in the toolbar and the app menu (hamburger menu)
   *
   * @param {Window} window chrome window
   */
  restrictEnterpriseView(window) {
    // Hides fxa toolbar button
    Services.prefs.setBoolPref("identity.fxaccounts.toolbar.enabled", false);

    // Hides fxa item and separator in main view (hamburg menu)
    window.PanelUI.mainView.setAttribute("restricted-enterprise-view", true);
  },

  /**
   * Displays the signout confirmation prompt if the promptOnSignout pref is
   * set, and saves the pref if the user unchecks it.
   *
   * @param {Window} window - Chrome window to use as dialog parent.
   * @returns {boolean} true if shutdown should proceed, false if the user cancelled.
   */
  showSignoutPrompt(window) {
    const shouldInformOnSignout = Services.prefs.getBoolPref(
      PROMPT_ON_SIGNOUT_PREF,
      true
    );

    if (!shouldInformOnSignout) {
      return true;
    }

    let tabCount = 0;
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      if (!win.closed && win.gBrowser) {
        tabCount += win.gBrowser.openTabs.length;
      }
    }

    const titleId =
      tabCount >= 2
        ? { id: "enterprise-signout-prompt-title-tabs", args: { tabCount } }
        : { id: "enterprise-signout-prompt-title" };

    const [title, message, checkLabel, signoutBtnLabel] =
      lazy.localization.formatValuesSync([
        titleId,
        { id: "enterprise-signout-prompt-message" },
        { id: "enterprise-signout-prompt-checkbox-label" },
        { id: "enterprise-signout-prompt-primary-btn-label" },
      ]);

    const flags =
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
      Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
      Services.prompt.BUTTON_POS_0_DEFAULT;

    const checkState = { value: true };
    // buttonPressed will be 0 for Signout and 1 for Cancel
    const buttonPressed = Services.prompt.confirmEx(
      window,
      title,
      message,
      flags,
      signoutBtnLabel,
      null,
      null,
      checkLabel,
      checkState
    );

    if (buttonPressed === 1) {
      // User canceled signout. Also ignore any checkbox toggling.
      return false;
    }

    if (!checkState.value) {
      // User unchecked the option to be prompted before signout
      Services.prefs.setBoolPref(PROMPT_ON_SIGNOUT_PREF, checkState.value);
    }

    return true;
  },

  /**
   * Handles the signout button in the enterprise panel: shows the confirmation
   * prompt if needed, then signs out and force-quits.
   *
   * @param {Window} window - Chrome window to use as dialog parent.
   */
  async onSignOut(window) {
    if (!this.showSignoutPrompt(window)) {
      return;
    }
    await this.initiateShutdown();
  },

  async initiateShutdown() {
    // TODO: Bug 2001029 - Assert or force-enable session restore?
    try {
      await lazy.ConsoleClient.signoutUser();
    } catch (e) {
      console.error(`Unable to signout the user: ${e}`);
    } finally {
      Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
    }
  },

  async _signoutOnShutdown() {
    if (!this._signoutAuthorized) {
      return;
    }
    try {
      await lazy.ConsoleClient.signoutUser();
    } catch (e) {
      console.error(`EnterpriseHandler: Unable to signout the user: ${e}`);
    }
  },

  uninit() {
    this._signedInUser = {};
    this._isInitialized = false;
    this._isLearnMoreLinkConfigured = false;
  },

  _updateLogo(window) {
    const logoUrl = Services.prefs.getStringPref(COMPANY_LOGO_URL_PREF, "");

    if (!logoUrl) {
      lazy.log.warn(
        `Unable to retrieve company logo url from: ${COMPANY_LOGO_URL_PREF}`
      );
      return;
    }

    const validLogoUrl = validateDataUrl(logoUrl);

    if (validLogoUrl !== null) {
      const toolbarLogoWrapper = window.document.querySelector(
        "#enterprise-company-logo__wrapper"
      );
      const toolbarLogo = toolbarLogoWrapper.querySelector("image");
      toolbarLogo.style.setProperty(
        "list-style-image",
        `url("${validLogoUrl.href}")`
      );
      toolbarLogoWrapper.classList.remove("is-hidden");
    }
  },
};
