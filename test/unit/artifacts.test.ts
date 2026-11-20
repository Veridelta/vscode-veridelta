// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";
import * as path from "node:path";

import { artifactPlan, candidatesFor, FORMATS } from "../../src/artifacts";

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
