/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { DownloadsTelemetryEnterprise } = ChromeUtils.importESModule(
  "moz-src:///browser/components/downloads/DownloadsTelemetry.enterprise.sys.mjs"
);

const DOWNLOAD_ENABLED_PREF = "browser.download.enterprise.telemetry.enabled";
const DOWNLOAD_URL_PREF = "browser.download.enterprise.telemetry.urlLogging";
const DOWNLOAD_FILE_PREF = "browser.download.enterprise.telemetry.fileLogging";
const PRINT_ENABLED_PREF = "print.enterprise.telemetry.printPage.enabled";
const TEST_URL = "https://example.com/path/file.pdf";

async function updatePolicies(policy) {
  const updateApplied = EnterprisePolicyTesting.awaitNextPolicyUpdate();
  EnterprisePolicyTesting.stubRemotePolicies(policy);
  await updateApplied;
}

add_task(async function test_security_logging_applied_updated_removed_live() {
  await EnterprisePolicyTesting.setupEngineWithRemotePolicies(
    {
      policies: {
        SecurityLogging: {
          Download: {
            Enabled: true,
            UrlLogging: "domain",
            FileLogging: "metadata",
          },
          PrintPage: { Enabled: true },
        },
      },
    },
    null
  );

  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_ENABLED_PREF, true, true);
  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_URL_PREF, "domain", true);
  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_FILE_PREF, "metadata", true);
  EnterprisePolicyTesting.checkPolicyPref(PRINT_ENABLED_PREF, true, true);
  Assert.ok(DownloadsTelemetryEnterprise._isEnabled());
  Assert.equal(
    DownloadsTelemetryEnterprise._processSourceUrl(TEST_URL),
    "example.com",
    "the download recorder observes the applied URL logging level"
  );
  Assert.deepEqual(
    DownloadsTelemetryEnterprise._processFileInfo(
      "file.pdf",
      "/tmp/file.pdf",
      "pdf",
      "application/pdf"
    ),
    {
      filename: "",
      file_path: "",
      extension: "pdf",
      mime_type: "application/pdf",
    },
    "the download recorder observes the applied file logging level"
  );

  await updatePolicies({
    policies: {
      SecurityLogging: {
        Download: {
          Enabled: false,
          UrlLogging: "none",
          FileLogging: "none",
        },
      },
    },
  });

  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_ENABLED_PREF, false, true);
  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_URL_PREF, "none", true);
  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_FILE_PREF, "none", true);
  EnterprisePolicyTesting.checkPolicyPref(PRINT_ENABLED_PREF, undefined, false);
  Assert.ok(!DownloadsTelemetryEnterprise._isEnabled());
  Assert.equal(
    DownloadsTelemetryEnterprise._processSourceUrl(TEST_URL),
    null,
    "the download recorder observes a live URL logging update"
  );
  Assert.deepEqual(
    DownloadsTelemetryEnterprise._processFileInfo(
      "file.pdf",
      "/tmp/file.pdf",
      "pdf",
      "application/pdf"
    ),
    { filename: "", file_path: "", extension: "", mime_type: "" },
    "the download recorder observes a live file logging update"
  );

  await updatePolicies({ policies: {} });

  EnterprisePolicyTesting.checkPolicyPref(
    DOWNLOAD_ENABLED_PREF,
    undefined,
    false
  );
  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_URL_PREF, undefined, false);
  EnterprisePolicyTesting.checkPolicyPref(DOWNLOAD_FILE_PREF, undefined, false);
  Assert.ok(DownloadsTelemetryEnterprise._isEnabled());
  Assert.equal(
    DownloadsTelemetryEnterprise._processSourceUrl(TEST_URL),
    TEST_URL,
    "the download recorder returns to its default after policy removal"
  );
});
