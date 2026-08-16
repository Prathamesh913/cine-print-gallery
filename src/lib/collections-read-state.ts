import type { UserCollection } from "./collections-core";
import { type ReadState, loadStart, loadSuccess, loadFailure } from "./read-state";

export const COLLECTIONS_LOAD_ERROR = "Couldn't load your collections.";

export type CollectionsAction =
  | { type: "START" }
  | { type: "SUCCESS"; data: UserCollection[] }
  | { type: "FAIL"; error: string }
  | { type: "SET"; data: UserCollection[] };

export function collectionsReducer(
  prev: ReadState<UserCollection[]>,
  action: CollectionsAction,
): ReadState<UserCollection[]> {
  switch (action.type) {
    case "START":
      return loadStart(prev);
    case "SUCCESS":
      return loadSuccess(prev, action.data);
    case "FAIL":
      // Preserve any previously valid collection list on failure.
      return loadFailure(prev, action.error);
    case "SET":
      return { ...prev, data: action.data };
  }
}
