/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { Updates } = ChromeUtils.importESModule(
  "resource://gre/modules/enterprise/Updates.sys.mjs"
);
const { AppUpdater } = ChromeUtils.importESModule(
  "resource://gre/modules/AppUpdater.sys.mjs"
);
const { sinon } = ChromeUtils.importESModule(
  "resource://testing-common/Sinon.sys.mjs"
);
const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);

function mockUpdater() {
  const sandbox = sinon.createSandbox();
  sandbox.stub(Updates, "updateCheckingAllowed").callsFake(async () => {
    Updates._canDoUpdateChecking = true;
  });
  const check = sandbox.stub(AppUpdater.prototype, "check");
  const stop = sandbox.stub(AppUpdater.prototype, "stop");
  const addListener = sandbox.spy(AppUpdater.prototype, "addListener");
  const removeListener = sandbox.spy(AppUpdater.prototype, "removeListener");
  return { sandbox, check, stop, addListener, removeListener };
}

add_task(async function test_reuses_an_in_progress_check() {
  const mock = mockUpdater();
  try {
    let finish;
    mock.check.callsFake(() => new Promise(resolve => (finish = resolve)));
    const result = Updates.prepareForRestart();
    await TestUtils.waitForCondition(() => mock.check.calledOnce);
    Assert.equal(
      Updates.prepareForRestart(),
      result,
      "Concurrent requests share the update"
    );
    Assert.ok(mock.check.calledOnce, "Only one update check runs");
    finish();
    await result;
    Assert.ok(mock.stop.calledOnce, "Updater listeners are disconnected");
    Assert.equal(
      mock.addListener.firstCall.args[0],
      mock.removeListener.firstCall.args[0]
    );
    mock.check.resolves();
    await Updates.prepareForRestart();
    Assert.equal(
      mock.check.callCount,
      2,
      "A later deadline can request a new check"
    );
  } finally {
    mock.sandbox.restore();
  }
});

add_task(async function test_failure_allows_a_later_check() {
  const mock = mockUpdater();
  try {
    mock.check.rejects(new Error("Update service unavailable"));
    await Assert.rejects(
      Updates.prepareForRestart(),
      /Update service unavailable/
    );
    Assert.equal(Updates._restartUpdateCheck, null);
    mock.check.resolves();
    await Updates.prepareForRestart();
    Assert.equal(mock.check.callCount, 2);
  } finally {
    mock.sandbox.restore();
  }
});

add_task(async function test_download_permission_matches_startup() {
  const mock = mockUpdater();
  try {
    const allow = mock.sandbox.stub(
      AppUpdater.prototype,
      "allowUpdateDownload"
    );
    mock.check.callsFake(async () => {
      mock.addListener.lastCall.args[0](AppUpdater.STATUS.DOWNLOAD_AND_INSTALL);
    });
    await Updates.prepareForRestart();
    Assert.ok(
      allow.calledOnce,
      "FELT permits the update download as at startup"
    );
  } finally {
    mock.sandbox.restore();
  }
});

add_task(async function test_repeated_install_failures_skip_check() {
  const mock = mockUpdater();
  try {
    Updates.updateCheckingAllowed.callsFake(async () => {
      Updates._canDoUpdateChecking = false;
    });
    await Updates.prepareForRestart();
    Assert.ok(
      mock.check.notCalled,
      "No update check after repeated install failures"
    );
  } finally {
    mock.sandbox.restore();
  }
});

add_task(async function test_shutdown_stops_the_check() {
  const mock = mockUpdater();
  try {
    const previousObservers = Array.from(
      Services.obs.enumerateObservers("quit-application")
    );
    let finish;
    mock.check.callsFake(() => new Promise(resolve => (finish = resolve)));
    mock.stop.callsFake(() => finish());
    const result = Updates.prepareForRestart();
    await TestUtils.waitForCondition(() => mock.check.calledOnce);
    const shutdownObserver = Array.from(
      Services.obs.enumerateObservers("quit-application")
    ).find(observer => !previousObservers.includes(observer));
    shutdownObserver.observe(null, "quit-application", null);
    await result;
    Assert.equal(
      Updates._restartUpdateCheck,
      null,
      "Shutdown clears the pending check"
    );
    Assert.ok(mock.stop.called, "The updater is stopped during shutdown");
  } finally {
    mock.sandbox.restore();
  }
});

add_task(async function test_ready_update_does_not_restart_felt() {
  const mock = mockUpdater();
  try {
    const restart = mock.sandbox.stub(Updates, "automaticRestart");
    mock.check.callsFake(async () => {
      mock.addListener.lastCall.args[0](AppUpdater.STATUS.READY_FOR_RESTART);
    });
    await Updates.prepareForRestart();
    Assert.ok(
      restart.notCalled,
      "Preparing the update does not restart the running session"
    );
  } finally {
    mock.sandbox.restore();
  }
});
