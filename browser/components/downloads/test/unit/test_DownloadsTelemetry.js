/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * Tests for Downloads Telemetry functionality.
 */

const { DownloadsTelemetry } = ChromeUtils.importESModule(
  "moz-src:///browser/components/downloads/DownloadsTelemetry.sys.mjs"
);

/**
 * Test that DownloadsTelemetry.recordFileDownloaded exists and doesn't throw
 * when called with a mock download object.
 */
add_task(async function test_recordFileDownloaded_basic() {
  // Verify the function exists
  Assert.strictEqual(
    typeof DownloadsTelemetry.recordFileDownloaded,
    "function",
    "recordFileDownloaded function should exist"
  );

  // Mock download object with basic properties
  const mockDownload = {
    target: {
      path: "/path/to/test.pdf",
      size: 12345,
    },
    source: {
      url: "https://example.com/test.pdf",
    },
    contentType: "application/pdf",
  };

  // Should not throw when called
  try {
    DownloadsTelemetry.recordFileDownloaded(mockDownload);
    Assert.ok(true, "recordFileDownloaded should not throw with valid input");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw: ${e}` );
  }
});

/**
 * Test that recordFileDownloaded handles edge cases gracefully.
 */
add_task(async function test_recordFileDownloaded_edge_cases() {
  // Test with null/undefined
  try {
    DownloadsTelemetry.recordFileDownloaded(null);
    Assert.ok(true, "recordFileDownloaded should handle null input");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw with null: ${e}`);
  }

  try {
    DownloadsTelemetry.recordFileDownloaded(undefined);
    Assert.ok(true, "recordFileDownloaded should handle undefined input");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw with undefined: ${e}`);
  }

  // Test with empty object
  try {
    DownloadsTelemetry.recordFileDownloaded({});
    Assert.ok(true, "recordFileDownloaded should handle empty object");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw with empty object: ${e}`);
  }

  // Test with minimal download object
  try {
    DownloadsTelemetry.recordFileDownloaded({
      target: {},
      source: {},
    });
    Assert.ok(true, "recordFileDownloaded should handle minimal object");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw with minimal object: ${e}`);
  }
});

/**
 * Test URL processing with different enterprise policies.
 * Note: This test primarily verifies the shim behavior. In MOZ_ENTERPRISE builds,
 * the actual enterprise implementation would be tested.
 */
add_task(async function test_url_processing_policies() {
  const testUrl = "https://example.com/path/to/file.pdf?param=value";

  const mockDownload = {
    target: {
      path: "/tmp/file.pdf",
      size: 1000,
    },
    source: {
      url: testUrl,
    },
    contentType: "application/pdf",
  };

  // The shim implementation should handle all policy configurations gracefully
  try {
    DownloadsTelemetry.recordFileDownloaded(mockDownload);
    Assert.ok(true, "recordFileDownloaded should handle downloads with URLs");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw with URL: ${e}`);
  }

  // Test with invalid URL
  const mockDownloadInvalidUrl = {
    ...mockDownload,
    source: {
      url: "not-a-valid-url",
    },
  };

  try {
    DownloadsTelemetry.recordFileDownloaded(mockDownloadInvalidUrl);
    Assert.ok(true, "recordFileDownloaded should handle invalid URLs");
  } catch (e) {
    Assert.ok(false, `recordFileDownloaded threw with invalid URL: ${e}`);
  }
});
