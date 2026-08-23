import { describe, expect, it } from "vitest";
import { parseServiceAccount, missingServiceAccountFields } from "../../src/lib/service-account";

const validAccount = {
  type: "service_account",
  project_id: "cineprint-prod",
  private_key_id: "abc123",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIexample\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk@cineprint-prod.iam.gserviceaccount.com",
  client_id: "12345",
};

describe("parseServiceAccount", () => {
  it("accepts a complete service-account JSON object", () => {
    const result = parseServiceAccount(JSON.stringify(validAccount));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.account.project_id).toBe("cineprint-prod");
      expect(result.account.private_key).toContain("\n");
    }
  });

  it("rejects an empty or missing value", () => {
    expect(parseServiceAccount(undefined).ok).toBe(false);
    expect(parseServiceAccount("").ok).toBe(false);
    expect(parseServiceAccount("   ").ok).toBe(false);
  });

  it("rejects malformed JSON without exposing the raw value", () => {
    const result = parseServiceAccount('{"project_id": "broken"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not valid JSON");
      expect(result.error).not.toContain("broken");
    }
  });

  it("rejects a non-object JSON value", () => {
    expect(parseServiceAccount("[1,2,3]").ok).toBe(false);
    expect(parseServiceAccount('"a string"').ok).toBe(false);
  });
});

describe("missingServiceAccountFields", () => {
  it("reports no missing fields for a complete account", () => {
    expect(missingServiceAccountFields(validAccount)).toEqual([]);
  });

  it("reports the required fields that are absent", () => {
    const missing = missingServiceAccountFields({ project_id: "x" });
    expect(missing).toEqual(["client_email", "private_key"]);
  });
});
