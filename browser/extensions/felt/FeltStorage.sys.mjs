/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @typedef {object} FeltData
 * @property {string | undefined} [lastSignedInUserEmail] - Email from last successful authentication
 */

/**
 * Storage helper for reading and writing felt-related profile data.
 */
export const FeltStorage = {
  /**
   * Absolute path to the enterprise data file stored in the profile directory.
   *
   * @type {string}
   */
  ENTERPRISE_FILE_PATH: PathUtils.join(PathUtils.profileDir, "felt.json"),

  /**
   * Reads and returns the felt data from felt.json.
   *
   * @returns {Promise<FeltData>} Promise resolving to the parsed
   *   felt data, or an empty object if unavailable.
   */
  async getFeltData() {
    const exists = await IOUtils.exists(this.ENTERPRISE_FILE_PATH);

    if (!exists) {
      return {};
    }

    try {
      return await IOUtils.readJSON(this.ENTERPRISE_FILE_PATH);
    } catch (err) {
      console.error(
        `Failed to read data from ${this.ENTERPRISE_FILE_PATH}`,
        err
      );
      return {};
    }
  },

  /**
   * Writes the passed data object to felt.json.
   *
   * @param {FeltData} data - The felt data object to persist.
   * @returns {Promise<void>} Promise that resolves once the file has been written.
   */
  async updateFeltData(data) {
    await IOUtils.writeJSON(this.ENTERPRISE_FILE_PATH, data);
  },

  /**
   * Gets the last signed-in user email stored in felt.json (if available).
   *
   * @returns {Promise<string | undefined>} The last signed-in user's email.
   */
  async getLastSignedInUser() {
    const data = await this.getFeltData();
    return data?.lastSignedInUserEmail;
  },

  /**
   * Updates the email that was last used to authenticate to the sso provider.
   *
   * @param {string} email - The email address of the last signed-in user.
   * @returns {Promise<void>} A promise that resolves when the data is updated.
   */
  async updateLastSignedInUserEmail(email) {
    const data = await this.getFeltData();

    if (data?.lastSignedInUserEmail === email) {
      // Nothing changed.
      return;
    }
    data.lastSignedInUserEmail = email;
    await this.updateFeltData(data);
  },
};
