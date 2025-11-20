/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Policies: "resource:///modules/policies/Policies.sys.mjs",
});

add_task(async function check_all_policies_are_live() {
  const allPolicies = new Set(Object.keys(lazy.Policies));

  // Set of policies we know cannot be live
  const notLivePolicies = new Set([
    "3rdparty",
    "AllowedDomainsForApps",
    "AllowFileSelectionDialogs",
    "AppAutoUpdate",
    "AppUpdatePin",
    "AppUpdateURL",
    "Authentication",
    "AutofillAddressEnabled",
    "AutofillCreditCardEnabled",
    "AutoLaunchProtocolsFromOrigins",
    "BackgroundAppUpdate",
    "Bookmarks",
    "BrowserDataBackup",
    "CaptivePortal",
    "Certificates",
    "Containers",
    "ContentAnalysis",
    "Cookies",
    "DefaultDownloadDirectory",
    "DisableAccounts",
    "DisableAppUpdate",
    "DisableBuiltinPDFViewer",
    "DisabledCiphers",
    "DisableDefaultBrowserAgent",
    "DisableEncryptedClientHello",
    "DisableFeedbackCommands",
    "DisableFirefoxAccounts",
    "DisableFirefoxScreenshots",
    "DisableFirefoxStudies",
    "DisableForgetButton",
    "DisableFormHistory",
    "DisableMasterPasswordCreation",
    "DisablePasswordReveal",
    "DisableProfileImport",
    "DisableProfileRefresh",
    "DisableSafeMode",
    "DisableSecurityBypass",
    "DisableSetDesktopBackground",
    "DisableSystemAddonUpdate",
    "DisableThirdPartyModuleBlocking",
    "DisplayBookmarksToolbar",
    "DisplayMenuBar",
    "DNSOverHTTPS",
    "DontCheckDefaultBrowser",
    "DownloadDirectory",
    "EnableTrackingProtection",
    "EncryptedMediaExtensions",
    "EnterpriseStorageEncryption",
    "ExemptDomainFileTypePairsFromFileTypeDownloadWarnings",
    "Extensions",
    "ExtensionSettings",
    "ExtensionUpdate",
    "FirefoxHome",
    "FirefoxSuggest",
    "GenerativeAI",
    "GoToIntranetSiteForSingleWordEntryInAddressBar",
    "Handlers",
    "HardwareAcceleration",
    "Homepage",
    "HttpAllowlist",
    "HttpsOnlyMode",
    "InstallAddonsPermission",
    "LegacyProfiles",
    "LegacySameSiteCookieBehaviorEnabled",
    "LegacySameSiteCookieBehaviorEnabledForDomainList",
    "LocalFileLinks",
    "LocalNetworkAccess",
    "ManagedBookmarks",
    "ManualAppUpdateOnly",
    "MicrosoftEntraSSO",
    "NetworkPrediction",
    "NewTabPage",
    "NoDefaultBookmarks",
    "OfferToSaveLogins",
    "OfferToSaveLoginsDefault",
    "OverrideFirstRunPage",
    "OverridePostUpdatePage",
    "PasswordManagerExceptions",
    "PDFjs",
    "Permissions",
    "PictureInPicture",
    "PopupBlocking",
    "PostQuantumKeyAgreementEnabled",
    "Preferences",
    "PrimaryPassword",
    "PrintingEnabled",
    "PromptForDownloadLocation",
    "RequestedLocales",
    "SanitizeOnShutdown",
    "SearchBar",
    "SearchEngines",
    "SearchSuggestEnabled",
    "SecurityDevices",
    "ShowHomeButton",
    "SkipTermsOfUse",
    "SSLVersionMax",
    "SSLVersionMin",
    "StartDownloadsInTempDirectory",
    "SupportMenu",
    "TranslateEnabled",
    "UserMessaging",
    "UseSystemPrintDialog",
    "VisualSearchEnabled",
    "WebsiteFilter",
    "WindowsSSO",
  ]);

  const allLivePolicies = allPolicies.difference(notLivePolicies);

  let liveEnabled = new Set();

  for (let policyName of allPolicies) {
    const policy = lazy.Policies[policyName];
    const hasOnRemove = typeof policy.onRemove === "function";
    if (hasOnRemove) {
      liveEnabled.add(policyName);
    }
  }

  const notEnabled = [
    ...allLivePolicies
      .difference(liveEnabled)
      .entries()
      .map(e => e[0]),
  ];
  if (notEnabled.length) {
    console.debug(`Not enabled live policies`, JSON.stringify(notEnabled));
  }

  Assert.equal(notEnabled.length, 0, "Not all policies are live. Work better.");

  const liveAndNotLive = [
    ...liveEnabled
      .intersection(notLivePolicies)
      .entries()
      .map(e => e[0]),
  ];
  if (liveAndNotLive.length) {
    console.debug(
      `Inconsistent state: live and not live`,
      JSON.stringify(liveAndNotLive)
    );
  }
  Assert.equal(
    liveAndNotLive.length,
    0,
    "There should be no policy both live and not live."
  );
});
