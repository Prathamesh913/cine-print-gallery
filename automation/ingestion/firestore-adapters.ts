/**
 * Firebase Admin adapters used by the automation CLI.
 *
 * Kept separate from the pure pipeline modules so unit tests never need Firebase
 * credentials or the Admin SDK.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { parseServiceAccount, missingServiceAccountFields } from "../../src/lib/service-account";
import {
  PosterDocumentMissingError,
  type PosterCatalog,
  type PosterDocument,
} from "./poster-catalog";
import type { FirestoreLike } from "./state";

export function initFirestore(serviceAccountJson: string | null) {
  if (getApps().length === 0) {
    if (!serviceAccountJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is required for apply runs");
    }
    const parsed = parseServiceAccount(serviceAccountJson);
    if (!parsed.ok) throw new Error(parsed.error);
    const missing = missingServiceAccountFields(parsed.account);
    if (missing.length > 0) {
      throw new Error(`Firebase service account is missing: ${missing.join(", ")}`);
    }
    initializeApp({
      credential: cert(parsed.account as unknown as Parameters<typeof cert>[0]),
    });
  }
  return getFirestore();
}

function isNotFoundError(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown };
  return (
    candidate?.code === "not-found" ||
    candidate?.code === 5 || // google-cloud Firestore NOT_FOUND
    candidate?.status === 404 ||
    candidate?.code === 404
  );
}

export class FirestorePosterCatalog implements PosterCatalog {
  constructor(
    private readonly db: FirestoreLike,
    private readonly collectionName = "posters",
  ) {}

  async get(id: string): Promise<PosterDocument | null> {
    const snapshot = await this.db.collection(this.collectionName).doc(id).get();
    if (!snapshot.exists) return null;
    return { id, data: snapshot.data() ?? {} };
  }

  async listAll(): Promise<PosterDocument[]> {
    const snapshot = await this.db.collection(this.collectionName).limit(1000).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} }));
  }

  async listByNotionPageId(pageId: string): Promise<PosterDocument[]> {
    const collection = this.db.collection(this.collectionName);
    if (!collection.where) return [];
    const snapshot = await collection.where("notionPageId", "==", pageId).limit(10).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} }));
  }

  async create(id: string, data: Record<string, unknown>): Promise<void> {
    await this.db
      .collection(this.collectionName)
      .doc(id)
      .set({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        syncedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  async update(id: string, data: Record<string, unknown>): Promise<void> {
    const ref = this.db.collection(this.collectionName).doc(id);
    if (!ref.update) {
      throw new PosterDocumentMissingError(id);
    }
    try {
      await ref.update({
        ...data,
        syncedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if (isNotFoundError(error)) throw new PosterDocumentMissingError(id);
      throw error;
    }
  }
}
