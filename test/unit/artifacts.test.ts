// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";
import * as path from "node:path";

import {
  artifactPlan,
  candidatesFor,
  FORMATS,
  isInside,
  planArtifacts,
  unchanged,
  writtenNow,
  writtenSince,
} from "../../src/artifacts";

const BASE = "primary_keys: [id]\nsource:\n  path: legacy.csv\ntarget:\n  path: modern.csv\n";
const FOLDER = path.resolve("/work/project");
const TEXT_FORMATS: readonly string[] = ["csv", "json", "ndjson"];

describe("artifactPlan", () => {
  it("is undefined without an output_path", () => {
    assert.equal(artifactPlan(BASE, FOLDER), undefined);
  });

  it("resolves a relative output_path against the configuration's folder, in Parquet by default", () => {
    assert.deepEqual(artifactPlan(`${BASE}output_path: out\n`, FOLDER), {
      folder: path.resolve(FOLDER, "out"),
      format: "parquet",
      textual: false,
      candidates: [
        "added_rows.parquet",
        "removed_rows.parquet",
        "changed_rows.parquet",
        "added_rows_pks_only.parquet",
        "removed_rows_pks_only.parquet",
        "changed_rows_pks_only.parquet",
        "changed_rows_sample.parquet",
      ],
    });
  });

  it("keeps an absolute output_path and opens text formats as text", () => {
    const absolute = path.resolve("/data/out");
    const plan = artifactPlan(`${BASE}output_path: ${absolute}\noutput_format: csv\n`, FOLDER);
    assert.ok(plan);
    assert.equal(plan.folder, absolute);
    assert.equal(plan.format, "csv");
    assert.equal(plan.textual, true);
    assert.ok(plan.candidates.every((name) => name.endsWith(".csv")));
  });

  it("knows which formats open as text", () => {
    for (const format of FORMATS) {
      const plan = artifactPlan(`${BASE}output_path: out\noutput_format: ${format}\n`, FOLDER);
      assert.equal(plan?.textual, TEXT_FORMATS.includes(format), format);
    }
  });

  it("is undefined for a format or a path it does not know, and for text that does not parse", () => {
    assert.equal(artifactPlan(`${BASE}output_path: out\noutput_format: xlsx\n`, FOLDER), undefined);
    assert.equal(artifactPlan(`${BASE}output_path: 5\n`, FOLDER), undefined);
    assert.equal(artifactPlan(`${BASE}output_path: ""\n`, FOLDER), undefined);
    assert.equal(artifactPlan("a: [1,", FOLDER), undefined);
    assert.equal(artifactPlan("- just\n- a list\n", FOLDER), undefined);
  });
});

describe("planArtifacts", () => {
  const OUT = path.resolve(FOLDER, "out");

  it("takes the last of two output_path keys, as Veridelta's YAML reader does", () => {
    const plan = artifactPlan(
      `${BASE}output_path: first\noutput_format: json\noutput_path: out\noutput_format: csv\n`,
      FOLDER,
    );
    assert.equal(plan?.folder, OUT);
    assert.equal(plan.format, "csv");
  });

  it("reads output_path beside a duplicate key elsewhere in the file", () => {
    const plan = artifactPlan(
      `${BASE}output_path: out\noutput_format: csv\nrules:\n  - column: a\n    column: b\n`,
      FOLDER,
    );
    assert.equal(plan?.folder, OUT);
  });

  it("reads an output_path given through an alias", () => {
    const plan = artifactPlan(`${BASE}x-out: &where out\noutput_path: *where\noutput_format: csv\n`, FOLDER);
    assert.equal(plan?.folder, OUT);
  });

  it("reads an output_path given through a merge key, and lets a direct key win", () => {
    const merged = `defaults: &defaults\n  output_path: out\n  output_format: csv\n${BASE}<<: *defaults\n`;
    assert.equal(artifactPlan(merged, FOLDER)?.folder, OUT);
    assert.equal(artifactPlan(`${merged}output_path: mine\n`, FOLDER)?.folder, path.resolve(FOLDER, "mine"));
  });

  it("follows merges as PyYAML does", () => {
    // Each answer is what PyYAML's safe_load, which Veridelta reads with, gives for output_path.
    const cases: [string, string][] = [
      ["%YAML 1.1\n---\n<<: {output_path: out, output_format: csv}\n", "out"],
      ["<<: {<<: {output_path: deep}}\n", "deep"],
      ["<<: {output_path: first}\n<<: {output_path: second}\n", "second"],
      ["<<: {output_path: a, output_path: b}\n", "b"],
      ["<<: [{output_path: first}, {output_path: second}]\n", "first"],
      ["output_path: own\n<<: {output_path: merged}\n", "own"],
      ["<<: [{<<: {output_path: inner}}, {output_path: second}]\n", "inner"],
    ];
    for (const [text, expected] of cases) {
      assert.equal(artifactPlan(`${text}${BASE}`, FOLDER)?.folder, path.resolve(FOLDER, expected), text);
    }
  });

  it("looks through repeated merges of one anchor in about the time of its text", () => {
    const levels = ["l0: &l0 {x: 1}"];
    for (let level = 1; level <= 30; level += 1) {
      levels.push(
        `l${String(level)}: &l${String(level)} {<<: [*l${String(level - 1)}, *l${String(level - 1)}]}`,
      );
    }
    const started = performance.now();
    const plan = planArtifacts(`${levels.join("\n")}\n<<: *l30\n${BASE}`, FOLDER);
    assert.deepEqual(plan, { plan: undefined, readable: true });
    assert.ok(performance.now() - started < 2000);
  });

  it("calls a file whose merges loop unreadable, rather than guess the folder", () => {
    // PyYAML gives p5 here and a lookup in tree order gives p4; Veridelta main refuses the file.
    const loop =
      "--- &r\n<<: &a3 {<<: [{output_path: p4}, *r]}\n<<: {<<: {<<: {output_path: p5}}, <<: *a3}\n";
    assert.deepEqual(planArtifacts(`${loop}${BASE}`, FOLDER), { plan: undefined, readable: false });
  });

  it("reads a setting a loop cannot change, as PyYAML does", () => {
    // A mapping's own pair beats its merges, so a loop among the merges does not matter.
    assert.equal(
      planArtifacts(`--- &r\n<<: *r\noutput_path: own\n${BASE}`, FOLDER).plan?.folder,
      path.resolve(FOLDER, "own"),
    );
    assert.equal(
      planArtifacts(`a: &a\n  <<: *a\n  output_path: one\n<<: *a\n${BASE}`, FOLDER).plan?.folder,
      path.resolve(FOLDER, "one"),
    );
    // No mapping a loop reaches sets it, so the configuration sets none.
    assert.deepEqual(planArtifacts(`--- &r\n<<: *r\n${BASE}`, FOLDER), { plan: undefined, readable: true });
  });

  it("reads a file whose anchors expand past any reasonable size, without expanding them", () => {
    const laughs = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 1; level < 10; level += 1) {
      const previous = String.fromCharCode(96 + level);
      const name = String.fromCharCode(97 + level);
      laughs.push(`${name}: &${name} [${Array(10).fill(`*${previous}`).join(", ")}]`);
    }
    const plan = artifactPlan(`${laughs.join("\n")}\n${BASE}output_path: out\noutput_format: csv\n`, FOLDER);
    assert.equal(plan?.folder, OUT);
  });

  it("says when it cannot read the file, rather than that it names no output_path", () => {
    assert.deepEqual(planArtifacts("a: [1,", FOLDER), { plan: undefined, readable: false });
    assert.deepEqual(planArtifacts(BASE, FOLDER), { plan: undefined, readable: true });
  });
});

describe("candidatesFor", () => {
  const plan = artifactPlan(`${BASE}output_path: out\noutput_format: csv\n`, FOLDER);

  it("keeps each kind the run counted rows of, local and pushdown names alike", () => {
    assert.ok(plan);
    assert.deepEqual(candidatesFor(plan, { added: 0, removed: 2, changed: 1 }), [
      "removed_rows.csv",
      "changed_rows.csv",
      "removed_rows_pks_only.csv",
      "changed_rows_pks_only.csv",
      "changed_rows_sample.csv",
    ]);
  });

  it("keeps nothing for a run with no rows that differ", () => {
    assert.ok(plan);
    assert.deepEqual(candidatesFor(plan, { added: 0, removed: 0, changed: 0 }), []);
  });
});

describe("isInside", () => {
  it("counts a path in the folder, and the folder itself, as inside", () => {
    assert.equal(isInside("/ws/out/a.csv", "/ws"), true);
    assert.equal(isInside("/ws", "/ws"), true);
    assert.equal(isInside("/ws/..data/a.csv", "/ws"), true, "a folder whose name starts with two dots");
  });

  it("counts a parent, a sibling, and another drive as outside", () => {
    assert.equal(isInside("/a.csv", "/ws"), false);
    assert.equal(isInside("/ws2/a.csv", "/ws"), false);
    assert.equal(isInside("/ws/../etc/passwd", "/ws"), false);
    assert.equal(isInside("D:\\data\\a.csv", "C:\\ws", path.win32), false);
    assert.equal(isInside("C:\\ws\\..data\\a.csv", "C:\\ws", path.win32), true);
  });
});

describe("writtenSince and unchanged", () => {
  const started = Date.UTC(2026, 10, 20, 12);

  it("takes a file written since the run started, allowing for coarse clocks", () => {
    assert.equal(writtenSince({ mtimeMs: started + 5, size: 1 }, started), true);
    assert.equal(writtenSince({ mtimeMs: started - 1500, size: 1 }, started), true);
    assert.equal(writtenSince({ mtimeMs: started - 60_000, size: 1 }, started), false);
  });

  it("tells a file another run rewrote from the one this run wrote", () => {
    assert.equal(unchanged({ mtimeMs: 10, size: 4 }, { mtimeMs: 10, size: 4 }), true);
    assert.equal(unchanged({ mtimeMs: 10, size: 4 }, { mtimeMs: 11, size: 4 }), false);
    assert.equal(unchanged({ mtimeMs: 10, size: 4 }, { mtimeMs: 10, size: 5 }), false);
    assert.equal(unchanged({ mtimeMs: 10, size: 4 }, undefined), false);
  });
});

describe("writtenNow", () => {
  const written = {
    "/ws/out/added_rows.csv": { mtimeMs: 10, size: 4 },
    "/ws/out/removed_rows.csv": { mtimeMs: 10, size: 4 },
    "/ws/out/changed_rows.csv": { mtimeMs: 10, size: 4 },
  };

  it("keeps the files as the run left them and says what happened to the others, without guessing why", () => {
    const now: Record<string, { mtimeMs: number; size: number }> = {
      "/ws/out/added_rows.csv": { mtimeMs: 10, size: 4 },
      "/ws/out/changed_rows.csv": { mtimeMs: 12, size: 9 },
    };
    assert.deepEqual(
      writtenNow(written, (file) => now[file]),
      {
        current: ["/ws/out/added_rows.csv"],
        notes: ["removed_rows.csv is gone", "changed_rows.csv changed after this run wrote it"],
      },
    );
  });
});
