import { describe, expect, it } from "vitest";
import {
  buildExternalImageProperty,
  isExternalBlobUrlFor,
  replaceExternalUrlAt,
} from "./external-image-migration";

const TWITTER = "https://pbs.twimg.com/media/other.jpg?format=jpg";
const BLOB =
  "https://store.public.blob.vercel-storage.com/cineprint/external/stranger-things-2.jpg";

describe("external image migration helpers", () => {
  it("replaces only the target URL position", () => {
    expect(replaceExternalUrlAt(["a", TWITTER, "c"], 1, TWITTER, BLOB)).toEqual(["a", BLOB, "c"]);
  });

  it("does not replace a changed target URL", () => {
    expect(replaceExternalUrlAt(["a", "changed", "c"], 1, TWITTER, BLOB)).toEqual([
      "a",
      "changed",
      "c",
    ]);
  });

  it("preserves URL property formatting", () => {
    expect(buildExternalImageProperty({ type: "url", url: "old" }, ["a", TWITTER, "c"])).toEqual({
      url: `a, ${TWITTER}, c`,
    });
  });

  it("preserves rich text property formatting", () => {
    expect(buildExternalImageProperty({ type: "rich_text", rich_text: [] }, ["a", BLOB])).toEqual({
      rich_text: [{ text: { content: `a\n${BLOB}` } }],
    });
  });

  it("derives deterministic external and optimized paths by Firebase ID", () => {
    expect(isExternalBlobUrlFor("stranger-things-2", BLOB)).toBe(true);
    expect(isExternalBlobUrlFor("the-substance-2", BLOB)).toBe(false);
  });
});
