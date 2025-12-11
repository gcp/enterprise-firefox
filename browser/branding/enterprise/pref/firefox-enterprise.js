/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global pref */

pref("enterprise.console.address", "https://console.enterfox.eu");

// Endpoint will be provided by the console.
pref(
  "identity.sync.tokenserver.uri",
  "https://ent-dev-tokenserver.sync.nonprod.webservices.mozgcp.net/1.0/sync/1.5"
);

// Sync enabled by default.
pref("enterprise.sync.enabledByDefault", true);

pref("browser.profiles.enabled", false);
pref("extensions.activeThemeID", "firefox-enterprise-light@mozilla.org");
