import { describe, expect, it } from "vitest";

import { assertSeedAllowed } from "@/lib/db/seed-guard";

describe("assertSeedAllowed", () => {
  it("allows development", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
  });

  it("allows test", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
  });

  it("refuses production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/NODE_ENV/);
  });

  it("refuses an unrecognized environment", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("refuses an unset NODE_ENV rather than defaulting to allowed", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: undefined })).toThrow(/unset/);
  });
});
