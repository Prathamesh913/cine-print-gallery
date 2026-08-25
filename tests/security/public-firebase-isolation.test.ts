import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

/**
 * C0 regression tripwire.
 *
 * Commit 71adf01 put static `import "firebase-admin/auth"` side effects in
 * src/lib/firebase.ts. Because every public route's module graph reaches
 * firebase.ts, homepage SSR eagerly loaded firebase-admin → jwks-rsa → jose
 * and crashed with ERR_REQUIRE_ESM before any handler ran.
 *
 * Invariant under test:
 *   importing src/lib/firebase.ts (and the public poster path) must NEVER
 *   evaluate src/server/firebase/admin.ts or any firebase-admin module.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

function src(rel: string): string {
  return fs.readFileSync(ROOT + rel, "utf8");
}

describe("public firebase module isolation", () => {
  it("src/lib/firebase.ts contains no runtime firebase-admin references", () => {
    const source = src("src/lib/firebase.ts");
    // Import-syntax-scoped: comments mentioning the admin module's location
    // are fine; actual import edges are not.
    expect(source).not.toMatch(/import\s+["']firebase-admin/);
    expect(source).not.toMatch(/from\s+["']firebase-admin/);
    expect(source).not.toMatch(/import\(\s*["']firebase-admin/);
    expect(source).not.toMatch(/from\s+["'][^"']*server\/firebase\/admin/);
    expect(source).not.toMatch(/import\(\s*["'][^"']*server\/firebase\/admin/);
  });

  it("the public poster path imports only the public firebase client module", () => {
    const source = src("src/lib/notion.ts");
    expect(source).toMatch(/import \{ db \} from ["']\.\/firebase["']/);
  });

  it("importing lib/firebase and loading posters never evaluates the Admin module", async () => {
    // Factory throws if anything statically imports the admin module —
    // vi.mock factories only run when the module is actually evaluated.
    vi.mock("../../src/server/firebase/admin", () => {
      throw new Error("REGRESSION: public path evaluated src/server/firebase/admin");
    });
    vi.mock("../../src/lib/firebase", () => ({
      db: { __publicClientDb: true },
      getProjectId: () => "test-proj",
    }));
    vi.mock("firebase/firestore", async (importOriginal) => {
      const actual = await importOriginal<typeof import("firebase/firestore")>();
      return {
        ...actual,
        collection: () => "posters-collection",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: (..._args: any[]) => "published-query",
        where: () => "status==published",
        getDocs: async () => ({ docs: [] }),
      };
    });

    const firebase = await import("../../src/lib/firebase");
    expect(firebase.getProjectId()).toBe("test-proj");

    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();
    // Zero published docs → genuine empty catalog ([]), with zero Admin code run.
    await expect(loadPublishedPosters()).resolves.toEqual([]);
  });

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
});
