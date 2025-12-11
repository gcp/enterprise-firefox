/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ConsoleClient: "resource:///modules/enterprise/ConsoleClient.sys.mjs",
  EnterpriseCommon: "resource:///modules/enterprise/EnterpriseCommon.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let { ConsoleAPI } = ChromeUtils.importESModule(
    "resource://gre/modules/Console.sys.mjs"
  );
  return new ConsoleAPI({
    prefix: "EnterpriseAccountStorage",
    maxLogLevel: "debug",
    maxLogLevelPref: "browser.enterprise.loglevel",
  });
});

/**
 * Acts as an FxAccountsStorage implementation, exposing the same APIs needed to setup FxA and Sync.
 *
 * Unlike the standard FxA/Sync storage, which is read from the profile, EnterpriseStorageManager retrieves
 * required FxA and Sync account data from the console.
 */
export class EnterpriseStorageManager {
  #getAccountDataPromise = Promise.reject(
    "EnterpriseStorageManager: Initialize not called"
  );

  /**
   * Gets the fxaccount data from the console and caches the promise.
   *
   * @param {object} _
   */
  initialize(_) {
    // If we just throw away our pre-rejected promise it is reported as an
    // unhandled exception when it is GCd - so add an empty .catch handler here
    // to prevent this.

    this.#getAccountDataPromise.catch(() => {});
    this.#getAccountDataPromise = lazy.ConsoleClient.getFxAccountData();
  }

  finalize() {}

  /**
   * Gets the account data from the enterprise user
   *
   * @param {Array<string>|string} [fieldNames=null]
   *
   * @returns {object} account data
   */
  async getAccountData(fieldNames = null) {
    lazy.log.debug("getAccountData");

    const data = await this.#getAccountDataPromise;

    if (fieldNames) {
      if (!Array.isArray(fieldNames)) {
        fieldNames = [fieldNames];
      }

      const subset = {};
      for (const name of fieldNames) {
        subset[name] = data[name];
      }
      return structuredClone(subset);
    }
    return structuredClone(data);
  }

  async updateAccountData(newFields) {
    const data = await this.#getAccountDataPromise;
    if (!("uid" in data)) {
      // If this storage instance shows no logged in user, then you can't
      // update fields.
      throw new Error("No user is logged in");
    }
    if (!newFields || "uid" in newFields) {
      throw new Error("Can't change uid");
    }
    lazy.log.debug("_updateAccountData with items", Object.keys(newFields));
    for (let [name, value] of Object.entries(newFields)) {
      if (value == null) {
        delete data[name];
        data[name] = null;
      } else {
        data[name] = value;
        if (name === "device") {
          const deviceId = data[name]?.id;
          if (deviceId) {
            Services.prefs.setStringPref(
              lazy.EnterpriseCommon.ENTERPRISE_DEVICE_ID_PREF,
              deviceId
            );
          }
        }
      }
    }
    this.#getAccountDataPromise = Promise.resolve(data);
  }

  deleteAccountData() {
    this.#getAccountDataPromise = Promise.reject(
      "EnterpriseStorageManager: Initialize not called"
    );
  }
}
