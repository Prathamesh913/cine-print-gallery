import { describe, it, expect } from "vitest";
import { bioReducer, type BioState } from "../src/lib/bio-editor";

const idle: BioState = {
  editing: false,
  saving: false,
  value: "",
  persisted: "",
  error: null,
  skipBlur: false,
};

describe("bioReducer", () => {
  it("START_EDIT enters edit mode with the persisted value", () => {
    const s = bioReducer(idle, { type: "START_EDIT", persisted: "hello" });
    expect(s.editing).toBe(true);
    expect(s.value).toBe("hello");
    expect(s.persisted).toBe("hello");
    expect(s.error).toBeNull();
  });

  it("CHANGE updates the draft value while editing", () => {
    const editing = bioReducer(idle, { type: "START_EDIT", persisted: "" });
    const changed = bioReducer(editing, { type: "CHANGE", value: "new bio" });
    expect(changed.value).toBe("new bio");
  });

  it("SAVE_START marks saving; a second SAVE_START while saving is a no-op", () => {
    const editing = bioReducer(idle, { type: "START_EDIT", persisted: "" });
    const started = bioReducer(editing, { type: "SAVE_START" });
    expect(started.saving).toBe(true);
    expect(bioReducer(started, { type: "SAVE_START" })).toBe(started);
  });

  it("SAVE_SUCCESS persists the value, exits edit mode, and arms skipBlur", () => {
    const editing = bioReducer(idle, { type: "START_EDIT", persisted: "old" });
    const started = bioReducer(editing, { type: "SAVE_START" });
    const done = bioReducer(started, { type: "SAVE_SUCCESS", value: "new" });
    expect(done.editing).toBe(false);
    expect(done.saving).toBe(false);
    expect(done.persisted).toBe("new");
    expect(done.value).toBe("new");
    expect(done.skipBlur).toBe(true);
  });

  it("SAVE_FAIL keeps editing, exposes an error, and never overwrites persisted", () => {
    const editing = bioReducer(idle, { type: "START_EDIT", persisted: "old" });
    const started = bioReducer(editing, { type: "SAVE_START" });
    const failed = bioReducer(started, { type: "SAVE_FAIL", error: "Couldn't save." });
    expect(failed.editing).toBe(true);
    expect(failed.saving).toBe(false);
    expect(failed.error).toBe("Couldn't save.");
    expect(failed.persisted).toBe("old");
    // Attempted value retained so the user can retry.
    expect(failed.value).toBe("old");
  });

  it("CANCEL exits edit mode, reverts to persisted, and arms skipBlur so a following blur cannot save", () => {
    const editing = bioReducer(idle, { type: "START_EDIT", persisted: "old" });
    const changed = bioReducer(editing, { type: "CHANGE", value: "unsaved" });
    const cancelled = bioReducer(changed, { type: "CANCEL" });
    expect(cancelled.editing).toBe(false);
    expect(cancelled.value).toBe("old");
    expect(cancelled.persisted).toBe("old");
    expect(cancelled.skipBlur).toBe(true);
    // After cancel, a save attempt is a no-op (not editing).
    expect(bioReducer(cancelled, { type: "SAVE_START" })).toBe(cancelled);
  });

  it("Escape/cancel never triggers a save: CONSUME_SKIP only clears the flag", () => {
    const cancelled = bioReducer(idle, { type: "CANCEL" });
    expect(cancelled.skipBlur).toBe(true);
    const consumed = bioReducer(cancelled, { type: "CONSUME_SKIP" });
    expect(consumed.skipBlur).toBe(false);
    expect(consumed.editing).toBe(false);
    expect(consumed.persisted).toBe("");
  });

  it("blur saves when appropriate: start -> change -> save success, then unmount blur is skipped", () => {
    let s = bioReducer(idle, { type: "START_EDIT", persisted: "" });
    s = bioReducer(s, { type: "CHANGE", value: "typed" });
    s = bioReducer(s, { type: "SAVE_START" });
    s = bioReducer(s, { type: "SAVE_SUCCESS", value: "typed" });
    // A blur fired by the editor unmounting is ignored via skipBlur.
    const afterBlur = bioReducer(s, { type: "CONSUME_SKIP" });
    expect(afterBlur.skipBlur).toBe(false);
    expect(afterBlur.persisted).toBe("typed");
    expect(afterBlur.editing).toBe(false);
  });

  it("blur + explicit save does not issue duplicate saves (saving guard)", () => {
    let s = bioReducer(idle, { type: "START_EDIT", persisted: "" });
    s = bioReducer(s, { type: "SAVE_START" });
    // A blur-triggered save attempt while a save is in progress is a no-op.
    expect(bioReducer(s, { type: "SAVE_START" })).toBe(s);
  });

  it("a failed save followed by cancel keeps the persisted value intact", () => {
    let s = bioReducer(idle, { type: "START_EDIT", persisted: "persisted-bio" });
    s = bioReducer(s, { type: "CHANGE", value: "attempted" });
    s = bioReducer(s, { type: "SAVE_START" });
    s = bioReducer(s, { type: "SAVE_FAIL", error: "Couldn't save." });
    s = bioReducer(s, { type: "CANCEL" });
    expect(s.persisted).toBe("persisted-bio");
    expect(s.value).toBe("persisted-bio");
    expect(s.editing).toBe(false);
    expect(s.error).toBeNull();
  });
});
