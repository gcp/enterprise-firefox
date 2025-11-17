/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

export const EnterpriseHandler = {
  /**
   * @typedef {object} User
   * @property {string} name name
   * @property {string} email email
   * @property {string} pictureUrl picture url
   */
  _signedInUser: null,
  _document: null,

  async init(window) {
    this._document = window.document;
    this.hideFxaToolbarButton();

    await this.initUser();
    this.updateBadge();
  },

  async initUser() {
    const { ConsoleClient } = ChromeUtils.importESModule(
      "resource:///modules/enterprise/ConsoleClient.sys.mjs"
    );
    const { name, email, picture } = await ConsoleClient.getLoggedInUserInfo();
    this._signedInUser = { name, email, pictureURL: picture };
  },

  updateBadge() {
    this._document.querySelector("#enterprise-user-icon").style["list-style-image"] =
      `url(${this._signedInUser.pictureURL})`;
  },

  openPanel(element, event) {
    this._document.ownerGlobal.PanelUI.showSubView("panelUI-enterprise", element, event);
    const emailSpan = this._document.querySelector(".panelUI-enterprise__email");
    if (!emailSpan.textContent) {
      this._document.querySelector(".panelUI-enterprise__email").textContent =
        this._signedInUser.email;
    }
  },

  /**
   * Hides FxA toolbar button
   * Todo: FxA shows up in a lot of different areas. For now we hide
   *       the most prominent toolbar button. How to hide or integrate
   *       with Fxa and Sync to be determined.
   */
  hideFxaToolbarButton() {
    this._document.getElementById("fxa-toolbar-menu-button").style.display = "none";
  },

  // TODO: Open signout dialog
  onSignOut() { },
};
