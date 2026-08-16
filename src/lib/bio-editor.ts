export interface BioState {
  editing: boolean;
  saving: boolean;
  value: string;
  persisted: string;
  error: string | null;
  /** Set after a save/cancel so the blur fired by the editor unmounting does not re-save. */
  skipBlur: boolean;
}

export type BioAction =
  | { type: "START_EDIT"; persisted: string }
  | { type: "CHANGE"; value: string }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; value: string }
  | { type: "SAVE_FAIL"; error: string }
  | { type: "CANCEL" }
  | { type: "CONSUME_SKIP" };

export function bioReducer(state: BioState, action: BioAction): BioState {
  switch (action.type) {
    case "START_EDIT":
      return {
        editing: true,
        saving: false,
        value: action.persisted,
        persisted: action.persisted,
        error: null,
        skipBlur: false,
      };
    case "CHANGE":
      return state.editing ? { ...state, value: action.value } : state;
    case "SAVE_START":
      // Guard against duplicate/concurrent saves.
      if (!state.editing || state.saving) return state;
      return { ...state, saving: true, error: null };
    case "SAVE_SUCCESS":
      return {
        editing: false,
        saving: false,
        value: action.value,
        persisted: action.value,
        error: null,
        skipBlur: true,
      };
    case "SAVE_FAIL":
      // Stay in edit mode with the attempted value so the user can retry;
      // the persisted value is never overwritten by a failed save.
      return { ...state, saving: false, error: action.error };
    case "CANCEL":
      return {
        editing: false,
        saving: false,
        value: state.persisted,
        persisted: state.persisted,
        error: null,
        skipBlur: true,
      };
    case "CONSUME_SKIP":
      return state.skipBlur ? { ...state, skipBlur: false } : state;
  }
}
