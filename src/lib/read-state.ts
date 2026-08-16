export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ReadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function readStateIdle<T>(data: T | null = null): ReadState<T> {
  return { data, loading: false, error: null };
}

export function loadStart<T>(prev: ReadState<T>): ReadState<T> {
  return { ...prev, loading: true, error: null };
}

export function loadSuccess<T>(prev: ReadState<T>, data: T): ReadState<T> {
  return { data, loading: false, error: null };
}

export function loadFailure<T>(prev: ReadState<T>, error: string): ReadState<T> {
  return { ...prev, loading: false, error };
}
