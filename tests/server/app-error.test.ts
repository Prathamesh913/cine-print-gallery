import { describe, expect, it } from "vitest";
import {
  APP_ERROR_CODES,
  AppError,
  conflict,
  infrastructure,
  notFound,
  unauthorized,
  unauthenticated,
  validationFailed,
} from "../../src/server/errors/app-error";

describe("AppError", () => {
  it("assigns category-default status codes", () => {
    expect(unauthenticated().statusCode).toBe(401);
    expect(unauthorized().statusCode).toBe(403);
    expect(validationFailed().statusCode).toBe(400);
    expect(notFound().statusCode).toBe(404);
    expect(conflict().statusCode).toBe(409);
    expect(infrastructure().statusCode).toBe(503);
  });

  it("allows explicit statusCode override", () => {
    const err = new AppError("NOT_FOUND", "No such poster", { statusCode: 410 });
    expect(err.statusCode).toBe(410);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("keeps safe public messages and preserves causes internally", () => {
    const cause = new Error("cred material xyz");
    const err = infrastructure("Firestore unavailable", { cause });
    expect(err.message).toBe("Firestore unavailable");
    expect(err.cause).toBe(cause);
  });

  it("carries secret-free meta for diagnostics", () => {
    const err = new AppError("CONFLICT", "dup", { meta: { collectionId: "c1" } });
    expect(err.meta).toEqual({ collectionId: "c1" });
  });

  it("is distinguishable from foreign errors", () => {
    expect(new AppError("INTERNAL", "x").name).toBe("AppError");
    class Fake extends Error {}
    expect(notFound() instanceof AppError).toBe(true);
    expect(new Fake("x") instanceof AppError).toBe(false);
  });

  it("exposes exactly the documented code set", () => {
    expect(APP_ERROR_CODES).toEqual([
      "UNAUTHENTICATED",
      "UNAUTHORIZED",
      "VALIDATION_FAILED",
      "NOT_FOUND",
      "CONFLICT",
      "INFRASTRUCTURE",
      "INTERNAL",
    ]);
  });
});
