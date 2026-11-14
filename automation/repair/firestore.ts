/**
 * Update-only Firestore access for the scoped poster repair.
 *
 * This deliberately does not expose create(). A repair must never resurrect a
 * missing catalogue document, and it must not rewrite unrelated fields.
 */

import { initFirestore } from "../ingestion/firestore-adapters";
import type { FirestoreLike } from "../ingestion/state";
import type { R2ImageReference } from "../../src/lib/r2-image-reference";
import type { FirestorePosterSnapshot, RepairFirestore } from "./repair";

export class FirestoreRepairStore implements RepairFirestore {
  constructor(
    private readonly db: FirestoreLike,
    private readonly collectionName = "posters",
  ) {}

  async getPoster(id: string): Promise<FirestorePosterSnapshot | null> {
    const snapshot = await this.db.collection(this.collectionName).doc(id).get();
    if (!snapshot.exists) return null;
    return { id, data: snapshot.data() ?? {} };
  }

  async updateR2Image(id: string, reference: R2ImageReference): Promise<void> {
    const ref = this.db.collection(this.collectionName).doc(id);
    if (!ref.update) {
      throw new Error(`Firestore document ${id} does not support update`);
    }
    // Only the delivery reference changes. No create, no timestamp rewrite, no
    // unrelated field replacement.
    await ref.update({ r2Image: reference });
  }
}

export function createFirestoreRepairStore(
  serviceAccountJson: string | null,
): FirestoreRepairStore {
  return new FirestoreRepairStore(initFirestore(serviceAccountJson) as unknown as FirestoreLike);
}
