import { describe, expect, it } from "vitest";
import {
  INITIAL_IMAGE_LOAD_STATE,
  imageStatusForKey,
  statusFromImage,
  withImageStatus,
} from "../src/lib/image-load-state";

describe("Lightbox image load state", () => {
  it("treats a complete image with naturalWidth > 0 as loaded", () => {
    expect(statusFromImage({ complete: true, naturalWidth: 800 })).toBe("loaded");
  });

  it("treats a complete image with naturalWidth 0 as an explicit error", () => {
    expect(statusFromImage({ complete: true, naturalWidth: 0 })).toBe("error");
  });

  it("keeps incomplete or missing images loading", () => {
    expect(statusFromImage({ complete: false, naturalWidth: 800 })).toBe("loading");
    expect(statusFromImage(null)).toBe("loading");
  });

  it("does not carry a loaded state to a new poster or URL key", () => {
    const state = withImageStatus("poster-a:url-a", "loaded");
    expect(imageStatusForKey(state, "poster-a:url-a")).toBe("loaded");
    expect(imageStatusForKey(state, "poster-b:url-b")).toBe("loading");
    expect(imageStatusForKey(state, "poster-a:url-b")).toBe("loading");
    expect(imageStatusForKey(state, null)).toBe("loading");
  });

  it("does not carry an error state to a new key", () => {
    const state = withImageStatus("poster-a:url-a", "error");
    expect(imageStatusForKey(state, "poster-a:url-a")).toBe("error");
    expect(imageStatusForKey(state, "poster-a:url-b")).toBe("loading");
  });

  it("starts loading before any image key is known", () => {
    expect(imageStatusForKey(INITIAL_IMAGE_LOAD_STATE, "poster-a:url-a")).toBe("loading");
  });
});
