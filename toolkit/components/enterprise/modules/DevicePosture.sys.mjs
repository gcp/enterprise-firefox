/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  composeOSNames: "resource://gre/modules/enterprise/EnterpriseOSInfo.sys.mjs",
  createEnterpriseLogger:
    "resource://gre/modules/enterprise/EnterpriseCommon.sys.mjs",
  EdrDetection: "resource://gre/modules/enterprise/EdrDetection.sys.mjs",
  MachineId: "resource://gre/modules/enterprise/MachineId.sys.mjs",
  TelemetryEnvironment: "resource://gre/modules/TelemetryEnvironment.sys.mjs",
  XPIDatabase: "resource://gre/modules/addons/XPIDatabase.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return lazy.createEnterpriseLogger("DevicePosture");
});

// The console tells us which EDR agents to probe for via the browser
// configuration; Felt stores that into this preference (a JSON string). When the
// preference is absent, empty, or malformed we probe nothing: we never probe
// every known agent by default. The console descriptor is also expected to carry
// a parallel osquery query list, but osquery collection is not implemented yet.
const EDR_AGENTS_PREF = "enterprise.posture.edr_agents";

// Add-on types we report in device posture.
const REPORTED_ADDON_TYPES = [
  "extension",
  "sitepermission",
  "siteperm_deprecated",
  "plugin",
  "mlmodel",
];

export const DevicePosture = {
  /**
   * Returns an add-on database for the profile that is about to launch, for use
   * from the Felt login/launcher process where AddonManager is not running.
   *
   * Rather than parse extensions.json by hand, we point the XPIDatabase at the
   * target profile's database and read it through the same getAddonsByTypes API
   * the browser uses, so the Felt and browser paths report identical shape and
   * semantics (locale-negotiated names, AddonWrapper.isActive, hidden-add-on
   * filtering). This mutates the process-global XPIDatabase singleton, which is
   * safe here: the Felt process does not run AddonManager for its own profile.
   *
   * @param {string} profileDir - Absolute path to the target profile directory.
   * @returns {Promise<object>} The XPIDatabase, pointed at profileDir.
   */
  async getDatabaseForFelt(profileDir) {
    if (!Services.felt.isFeltUI()) {
      throw new Error("getDatabaseForFelt() must only be called in Felt");
    }

    const extensionsJson = PathUtils.join(profileDir, "extensions.json");
    lazy.log.debug(`getDatabaseForFelt(): ${extensionsJson}`);

    // Point the database at the target profile and force a fresh load, so
    // repeated posture collections (the change monitor) always read current
    // on-disk state rather than a cached view of another profile.
    lazy.XPIDatabase.jsonFilePath = extensionsJson;
    lazy.XPIDatabase._dbPromise = null;

    return lazy.XPIDatabase;
  },

  /**
   * Returns the AddonManager as the add-on database for the running browser.
   *
   * @param {object} [options]
   * @param {boolean} [options.waitForAddons=false] - Block until AddonManager is
   *   ready so the current list is always reported; otherwise return null when it
   *   is not ready yet, to avoid blocking startup.
   * @returns {Promise<object|null>}
   */
  async getDatabaseForApp({ waitForAddons = false } = {}) {
    if (!lazy.AddonManager.isReady) {
      if (waitForAddons) {
        await lazy.AddonManager.readyPromise;
      } else {
        return null;
      }
    }
    return lazy.AddonManager;
  },

  /**
   * Reads the installed add-ons for device posture. In the Felt process, reads
   * the (soon to launch) profile's on-disk database when profileDir is known;
   * in the browser, reads the running AddonManager. Returns null when the list
   * cannot be determined (Felt without a known profile, or AddonManager not
   * ready and not waited on).
   *
   * @param {object} [options]
   * @param {string|null} [options.profileDir=null]
   * @param {boolean} [options.waitForAddons=false]
   * @returns {Promise<DeviceAddon[]|null>}
   */
  async getExtensions({ profileDir = null, waitForAddons = false } = {}) {
    try {
      let database = null;
      if (Services.felt.isFeltUI()) {
        // The profile (and thus its extension list) is only known once SSO has
        // resolved the user id; without it we cannot report extensions.
        if (!profileDir) {
          return null;
        }
        database = await this.getDatabaseForFelt(profileDir);
      } else if (Services.felt.isFeltBrowser()) {
        database = await this.getDatabaseForApp({ waitForAddons });
      }

      if (!database) {
        return null;
      }

      const addons = await database.getAddonsByTypes(REPORTED_ADDON_TYPES);
      return addons.map(addon => ({
        id: addon.id,
        name: addon.name ?? "",
        type: addon.type,
        version: addon.version ?? "",
        enabled: addon.isActive,
      }));
    } catch (ex) {
      lazy.log.error("Error while getting extensions for device posture", ex);
      return null;
    }
  },

  /**
   * @typedef {object} DeviceNetwork
   * @property {string} mobileEquipmentId IMEI when available, else "".
   * @property {any} interfaces Network interfaces from nsINetworkLinkService.
   */

  /**
   * @typedef {object} DeviceAddon
   * @property {string} id Addon identifier.
   * @property {string} name Human-readable display name.
   * @property {string} type Addon type (extension, plugin, sitepermission, etc).
   * @property {string} version Addon version string.
   * @property {boolean} enabled Whether the addon is currently active.
   */

  /**
   * @typedef {object} DeviceMachineId
   * @property {string} id Raw platform machine identifier (e.g. device serial).
   * @property {string|null} source Source tier the identifier was resolved from.
   */

  /**
   * @typedef {object} DeviceEdr
   * @property {string} name EDR agent identifier (e.g. "crowdstrike").
   */

  /**
   * @typedef {object} DevicePosture
   * @property {object} os Telemetry-reported os information.
   * @property {object|undefined} security Telemetry-reported security software info (windows only)
   * @property {object} build Telemetry-reported build info info
   * @property {DeviceNetwork} network Network posture.
   * @property {DeviceAddon[]|null} extensions Installed browser addons, or null if not yet available.
   * @property {DeviceMachineId|null} machineId Stable machine identifier, or null if unavailable.
   * @property {boolean} secureBootEnabled Whether Secure Boot is enabled.
   * @property {boolean} isDomainJoined Whether the machine is joined to a domain (Windows on-prem AD or Azure AD/Entra).
   * @property {DeviceEdr[]} presentEdrs Detected EDR agents (empty if none, or if the console asked us to probe none).
   */

  /**
   * Collects the device posture from TelemetryEnvironment.currentEnvironment
   * and other data sources.
   *
   * @param {object} [options]
   * @param {boolean} [options.waitForAddons=false] - Whether to block until
   *   AddonManager is ready so extensions are always reported (browser context).
   * @param {string|null} [options.profileDir=null] - When set (Felt context,
   *   before the browser starts), read the extension list from this profile's
   *   on-disk addon database instead of AddonManager.
   * @returns {Promise<DevicePosture>} devicePosture
   */
  async collect({ waitForAddons = false, profileDir = null } = {}) {
    const getImeiValue = async () => {
      try {
        return await Cc["@mozilla.org/imei/provider;1"]
          .getService()
          .QueryInterface(Ci.nsIImeiProvider).imei;
      } catch {
        return "";
      }
    };

    const getMachineId = async () => {
      try {
        const id = await lazy.MachineId.getRawId();
        if (!id) {
          return null;
        }
        return {
          id,
          source: await lazy.MachineId.getSource(),
        };
      } catch {
        return null;
      }
    };

    const networkInterfaces = Cc["@mozilla.org/network/network-link-service;1"]
      .getService()
      .QueryInterface(Ci.nsINetworkLinkService).networkInterfaces;

    const baseOs = lazy.TelemetryEnvironment.currentEnvironment.system.os;
    const { long: os_long_name, short: os_short_name } =
      await lazy.composeOSNames(baseOs);
    const os = {
      ...baseOs,
      ...(os_long_name != null && { os_long_name }),
      ...(os_short_name != null && { os_short_name }),
    };

    // Read the console-supplied probe list. An absent, empty, or malformed
    // preference means "probe nothing". This matters especially for EDR:
    // EdrDetection.getPresentEdrs([]) treats an empty list as "probe every known
    // agent", so we must short-circuit rather than pass it an empty array.
    const readJsonArrayPref = pref => {
      try {
        // getStringPref's default only covers an unset pref; a pref set to a
        // non-string type still throws, so keep the read inside the try.
        const raw = Services.prefs.getStringPref(pref, "");
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        lazy.log.error(`Malformed ${pref}, probing nothing:`, e);
        return [];
      }
    };

    const edrAgentsToProbe = readJsonArrayPref(EDR_AGENTS_PREF);

    const getPresentEDRs = async () => {
      if (!edrAgentsToProbe.length) {
        return [];
      }
      return (await lazy.EdrDetection.getPresentEdrs(edrAgentsToProbe)).map(
        name => ({ name })
      );
    };

    // The console descriptor is also expected to carry an osquery query list,
    // parallel to the EDR agent list above; when osquery execution lands it would
    // be collected here (read from an OSQUERY_QUERIES_PREF, probe-none default)
    // and added to the payload below.

    // These probes are independent, and some are slow (subprocess spawns, addon
    // manager readiness, an `ioreg` shell-out), so run them concurrently rather
    // than serializing the awaits.
    const [mobileEquipmentId, extensions, machineId, presentEdrs] =
      await Promise.all([
        getImeiValue(),
        this.getExtensions({ profileDir, waitForAddons }),
        getMachineId(),
        getPresentEDRs(),
      ]);

    const devicePosturePayload = {
      os,
      security: lazy.TelemetryEnvironment.currentEnvironment.system.sec,
      build: lazy.TelemetryEnvironment.currentEnvironment.build,
      network: {
        mobileEquipmentId,
        interfaces: networkInterfaces,
      },
      extensions,
      machineId,
      secureBootEnabled:
        Services.sysinfo.getPropertyAsBool("secureBootEnabled"),
      isDomainJoined: Services.sysinfo.getPropertyAsBool("isDomainJoined"),
      presentEdrs,
    };
    return devicePosturePayload;
  },
};
