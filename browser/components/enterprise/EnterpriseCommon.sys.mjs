/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const IS_TESTING_ENVIRONMENT = "enterprise.is_testing";
const IS_BLOCKING_SHUTDOWN = "enterprise.felt_tests.is_blocking_shutdown";

export const isTesting = () => {
  return Services.prefs.getBoolPref(IS_TESTING_ENVIRONMENT, false);
};

export const isBlockingShutdown = () => {
  return Services.prefs.getBoolPref(IS_BLOCKING_SHUTDOWN, false);
};

export const EnterpriseCommon = {
  ENTERPRISE_DEVICE_ID_PREF: "enterprise.sync.device_id",
  ENTERPRISE_LOGLEVEL_PREF: "enterprise.loglevel",
};
