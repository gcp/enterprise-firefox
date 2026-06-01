/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { MachineId } = ChromeUtils.importESModule(
  "resource://gre/modules/MachineId.sys.mjs"
);

function sha256Hex(message) {
  let hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(hasher.SHA256);
  let data = new TextEncoder().encode(message);
  hasher.update(data, data.length);
  return Array.from(hasher.finish(false), c =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

function makeRawSmbiosTable(structures) {
  let tableData = structures.flat();
  let length = tableData.length;
  return [0, 3, 2, 0, length & 0xff, (length >> 8) & 0xff, 0, 0].concat(
    tableData
  );
}

function makeType1SystemInformation(uuidBytes) {
  return [
    1,
    0x19,
    0,
    0,
    1,
    2,
    0,
    0,
    ...uuidBytes,
    0,
    "S".charCodeAt(0),
    "y".charCodeAt(0),
    "s".charCodeAt(0),
    0,
    0,
  ];
}

function makeType0BiosInformation(serial) {
  let serialBytes = Array.from(serial, char => char.charCodeAt(0));
  return [
    0,
    0x12,
    0,
    0,
    1,
    0,
    2,
    0,
    3,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    "V".charCodeAt(0),
    "e".charCodeAt(0),
    "n".charCodeAt(0),
    "d".charCodeAt(0),
    "o".charCodeAt(0),
    "r".charCodeAt(0),
    0,
    "B".charCodeAt(0),
    "I".charCodeAt(0),
    "O".charCodeAt(0),
    "S".charCodeAt(0),
    0,
    ...serialBytes,
    0,
    0,
  ];
}

function makeEndOfTable() {
  return [127, 4, 0, 0, 0, 0];
}

add_task(function test_parse_windows_firmware_table_prefers_uuid() {
  let uuidBytes = [
    0x67, 0x45, 0x23, 0x01, 0xab, 0x89, 0xef, 0xcd, 0x10, 0x32, 0x54, 0x76,
    0x98, 0xba, 0xdc, 0xfe,
  ];
  let rawTable = makeRawSmbiosTable([
    makeType1SystemInformation(uuidBytes),
    makeType0BiosInformation("BIOS-SERIAL"),
    makeEndOfTable(),
  ]);

  Assert.deepEqual(MachineId._parseWindowsFirmwareTable(rawTable), {
    id: "01234567-89ab-cdef-1032-547698badcfe",
    source: "firmware-uuid",
  });
});

add_task(
  function test_parse_windows_firmware_table_falls_back_to_bios_serial() {
    let rawTable = makeRawSmbiosTable([
      makeType1SystemInformation(new Array(16).fill(0)),
      makeType0BiosInformation("BIOS-SERIAL"),
      makeEndOfTable(),
    ]);

    Assert.deepEqual(MachineId._parseWindowsFirmwareTable(rawTable), {
      id: "BIOS-SERIAL",
      source: "bios-serial",
    });
  }
);

add_task(function test_parse_windows_firmware_table_rejects_all_ff_uuid() {
  let rawTable = makeRawSmbiosTable([
    makeType1SystemInformation(new Array(16).fill(0xff)),
    makeType0BiosInformation("BIOS-SERIAL"),
    makeEndOfTable(),
  ]);

  Assert.deepEqual(MachineId._parseWindowsFirmwareTable(rawTable), {
    id: "BIOS-SERIAL",
    source: "bios-serial",
  });
});

add_task(function test_parse_windows_firmware_table_no_type1() {
  let rawTable = makeRawSmbiosTable([
    makeType0BiosInformation("BIOS-SERIAL"),
    makeEndOfTable(),
  ]);

  Assert.deepEqual(MachineId._parseWindowsFirmwareTable(rawTable), {
    id: "BIOS-SERIAL",
    source: "bios-serial",
  });
});

add_task(function test_parse_windows_firmware_table_no_identifiers() {
  let rawTable = makeRawSmbiosTable([makeEndOfTable()]);

  equal(MachineId._parseWindowsFirmwareTable(rawTable), null);
});

function withStubbedRawId(rawId, callback) {
  let originalGetRawId = MachineId.getRawId;
  MachineId.getRawId = () => Promise.resolve(rawId);
  MachineId.clearCache();
  return (async () => {
    try {
      return await callback();
    } finally {
      MachineId.getRawId = originalGetRawId;
      MachineId.clearCache();
    }
  })();
}

add_task(async function test_get_hashed_id_returns_salted_sha256() {
  await withStubbedRawId("test-machine-id", async () => {
    let hashed = await MachineId.getHashedId();
    Assert.ok(/^[0-9a-f]{64}$/.test(hashed), "Should be a SHA-256 hex digest");
    notEqual(
      hashed,
      await sha256Hex("test-machine-id"),
      "Should not be the bare hash of the raw ID (namespace salt is applied)"
    );
  });
});

add_task(async function test_get_hashed_id_is_deterministic_per_input() {
  let first = await withStubbedRawId("machine-a", () =>
    MachineId.getHashedId()
  );
  let firstAgain = await withStubbedRawId("machine-a", () =>
    MachineId.getHashedId()
  );
  let other = await withStubbedRawId("machine-b", () =>
    MachineId.getHashedId()
  );

  equal(first, firstAgain, "Same raw ID should hash to the same value");
  notEqual(first, other, "Different raw IDs should hash to different values");
});

add_task(async function test_get_hashed_id_null_when_no_raw_id() {
  await withStubbedRawId(null, async () => {
    equal(
      await MachineId.getHashedId(),
      null,
      "Should return null when no raw ID is available"
    );
  });
});

add_task(async function test_clear_cache_recomputes_hashed_id() {
  let originalGetRawId = MachineId.getRawId;
  let calls = 0;
  MachineId.getRawId = () => {
    calls++;
    return Promise.resolve("cached-machine-id");
  };
  MachineId.clearCache();

  try {
    let first = await MachineId.getHashedId();
    await MachineId.getHashedId();
    equal(calls, 1, "Hashed ID should be cached after the first computation");

    MachineId.clearCache();
    let afterClear = await MachineId.getHashedId();
    equal(calls, 2, "clearCache should force the hash to be recomputed");
    equal(
      first,
      afterClear,
      "Recomputed hash should match for the same raw ID"
    );
  } finally {
    MachineId.getRawId = originalGetRawId;
    MachineId.clearCache();
  }
});

function withStubbedResolve(resolved, callback) {
  let originalResolve = MachineId._resolve;
  MachineId._resolve = () => Promise.resolve(resolved);
  MachineId.clearCache();
  return (async () => {
    try {
      return await callback();
    } finally {
      MachineId._resolve = originalResolve;
      MachineId.clearCache();
    }
  })();
}

add_task(async function test_get_source_reflects_resolved_source() {
  await withStubbedResolve(
    { id: "abc", source: "ioplatform-serial" },
    async () => {
      equal(
        await MachineId.getSource(),
        "ioplatform-serial",
        "Should expose the source tier the ID was resolved from"
      );
      equal(await MachineId.getRawId(), "abc", "Should expose the resolved ID");
    }
  );
});

add_task(async function test_get_source_null_when_unresolved() {
  await withStubbedResolve(null, async () => {
    equal(
      await MachineId.getSource(),
      null,
      "Should return null source when no ID could be resolved"
    );
    equal(await MachineId.getRawId(), null, "Should return null ID as well");
  });
});
