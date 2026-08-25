import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readHighLevelConfig } from "@/lib/intake/config";

const ENV_KEYS = ["HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN", "HIGHLEVEL_LOCATION_ID"] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("readHighLevelConfig", () => {
  it("returns the configured values", () => {
    process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN = "test-token";
    process.env.HIGHLEVEL_LOCATION_ID = "test-location-id";

    expect(readHighLevelConfig()).toEqual({
      privateIntegrationToken: "test-token",
      locationId: "test-location-id",
    });
  });

  it("throws naming every missing variable, and never includes a value in the message", () => {
    process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN = "should-not-appear-in-error";

    let thrown: unknown;
    try {
      readHighLevelConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("HIGHLEVEL_LOCATION_ID");
    expect(message).not.toContain("HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN");
    expect(message).not.toContain("should-not-appear-in-error");
  });

  it("throws naming both variables when neither is set", () => {
    expect(() => readHighLevelConfig()).toThrow(
      /HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN, HIGHLEVEL_LOCATION_ID/,
    );
  });
});
