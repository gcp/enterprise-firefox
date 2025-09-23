/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals ExtensionAPI, Services, XPCOMUtils */


this.felt = class extends ExtensionAPI {

  FELT_PROCESS_ACTOR = "FeltProcess";
  FELT_WINDOW_ACTOR = "FeltWindow";

  registerChrome() {
    let aomStartup = Cc[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Ci.amIAddonManagerStartup);

    const manifestURI = Services.io.newURI(
      "manifest.json",
      null,
      this.extension.rootURI
    );

    this.chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "felt", "content/"],
    ]);
  }

  setFeltPrefs() {
    const consoleAddr = Services.prefs.getStringPref("browser.felt.console");
    const prefs = [
      ["browser.felt.sso_url", `${consoleAddr}/sso_url`],
      ["browser.felt.matches", `${consoleAddr}/dashboard`],
      ["browser.felt.redirect_after_sso", `${consoleAddr}/redirect_after_sso`],
    ];

    prefs.forEach(pref => {
      const name = pref[0];
      const value = pref[1];

      switch (typeof value) {
        case "boolean":
          try {
            Services.prefs.getBoolPref(name);
          } catch {
            Services.prefs.setBoolPref(name, value);
          }
          break;

        case "string":
          try {
            Services.prefs.getStringPref(name);
          } catch {
            Services.prefs.setStringPref(name, value);
          }
          break;

        case "number":
          try {
            Services.prefs.getIntPref(name);
          } catch {
            Services.prefs.setIntPref(name, value);
          }
          break;
      }
    });
  }

  registerActors() {
    const matches = Services.prefs
          .getStringPref("browser.felt.matches")
          .split(",");
    ChromeUtils.registerWindowActor(this.FELT_WINDOW_ACTOR, {
      child: {
        esModuleURI: "chrome://felt/content/FeltWindowChild.sys.mjs",
        events: {
          DOMContentLoaded: {},
          load: {},
        },
      },
      allFrames: true,
      matches,
    })

    ChromeUtils.registerProcessActor(this.FELT_PROCESS_ACTOR, {
      parent: {
        esModuleURI: "chrome://felt/content/FeltProcessParent.sys.mjs",
      },
    })
  }

  onStartup() {
    this.feltXPCOM = Cc["@mozilla.org/toolkit/library/felt;1"].getService(
      Ci.nsIFelt
    );

    if (this.feltXPCOM.isFeltUI()) {
      this.setFeltPrefs();
      this.registerChrome();
      this.registerActors();
      this.showWindow();
      Services.ppmm.addMessageListener("FeltParent:FirefoxNormalExit", this);
      Services.ppmm.addMessageListener("FeltParent:FirefoxAbnormalExit", this);
      Services.ppmm.addMessageListener("FeltParent:FirefoxStarted", this);
    }
  }

  receiveMessage(message) {
    console.debug(`FeltExtension: ${message.name} handling ...`);
    switch (message.name) {

      case "FeltParent:FirefoxNormalExit":
        Services.ppmm.removeMessageListener(
          "FeltParent:FirefoxNormalExit",
          this
        );
        Services.startup.quit(
          Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eConsiderQuit
        );
        break;

      case "FeltParent:FirefoxAbnormalExit":
        Services.ppmm.removeMessageListener(
          "FeltParent:FirefoxAbnormalExit",
          this
        );
        // TODO: What should we do, restart Firefox?
        break;

      case "FeltParent:FirefoxStarted":
        Services.startup.enterLastWindowClosingSurvivalArea();
        Services.ww.unregisterNotification(this.windowObserver);
        this._win.close();
        const success = this.feltXPCOM.makeBackgroundProcess();
        console.debug(`FeltExtension: makeBackgroundProcess? ${success}`);
        break;

      default:
        console.debug(`FeltExtension: ${message.name} NOT HANDLED`);
        break;
    }
  }

  windowObserver(subject, topic) {
    console.debug(`FeltExtension: topic=${topic}`);
    if (topic === "domwindowopened") {
      Services.startup.exitLastWindowClosingSurvivalArea();
    }

    if (topic === "domwindowclosed" && this._win === subject) {
      Services.ww.unregisterNotification(this.windowObserver);
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eConsiderQuit
      );
    }
  }

  showWindow() {

    // Height and width are for now set to fit the sso.mozilla.com without the need to resize the window
    let flags = "chrome,centerscreen,titlebar,resizable,width=727,height=772";
    this._win = Services.ww.openWindow(
      null,
      "chrome://felt/content/felt.xhtml",
      "_blank",
      flags,
      null
    );

    Services.ww.registerNotification(this.windowObserver);

    // The window will send notifyObservers() itself. This is required
    // to make sure things are starting properly, including registration
    // of browsers with Marionette
  }

  onShutdown(isAppShutdown) {
    console.debug(`FeltExtension: onShutdown: ${isAppShutdown}`);

    if (isAppShutdown) {
      return;
    }

    Services.ppmm.removeMessageListener("FeltChild:Loaded", this);

    this.chromeHandle.destruct();
    this.chromeHandle = null;

    ChromeUtils.unregisterWindowActor(this.FELT_WINDOW_ACTOR);
    ChromeUtils.unregisterProcessActor(this.FELT_PROCESS_ACTOR);
  }
};
