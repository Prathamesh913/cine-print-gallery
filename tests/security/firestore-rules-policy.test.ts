import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression tripwire for two Firestore rule gaps found in security audit run 1.
 *
 * 1. /posters granted `allow read: if true`. The public catalogue contract is
 *    "published only", but that lived solely in application queries
 *    (src/lib/notion.ts filters where status == 'published'). Every other
 *    document in the collection — drafts, anonymous submissions in review, and
 *    artwork withdrawn by rewriting status to 'archived' — stayed readable to
 *    anyone holding the shipped web config.
 *
 * 2. The /collections update rule compared `resource.data.ownerId` against the
 *    caller but never pinned `request.resource.data.ownerId`, so an owner could
 *    create a collection and then repoint it at another uid. Server functions
 *    list collections by ownerId through the Admin SDK (which bypasses rules),
 *    so attacker-authored fields could surface in a victim's own list.
 *
 * Invariant under test:
 *
 *   world-readable posters == published posters
 *   collection ownership is immutable after creation
 *   clients may only write the collection fields the app defines
 *
 * Why a source scan: the repo has no rules unit-test harness (no
 * @firebase/rules-unit-testing, no emulator config), and rules are deployed
 * out of band. Asserting the policy text in CI at least catches a regression or
 * a careless revert before deploy.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const raw = fs.readFileSync(path.join(repoRoot, "firestore.rules"), "utf8");
// Collapse formatting so assertions survive re-wrapping.
const rules = raw.replace(/\s+/g, " ");

function matchBlock(name: string): string {
  const start = rules.indexOf(`match /${name}/{id} {`);
  expect(start, `rules must define match /${name}/{id}`).toBeGreaterThan(-1);
  const next = rules.indexOf("match /", start + 1);
  return next === -1 ? rules.slice(start) : rules.slice(start, next);
}

describe("firestore.rules policy", () => {
  describe("/posters", () => {
    const block = () => matchBlock("posters");

    it("limits world-readable posters to published records", () => {
      expect(block()).toMatch(/allow read: if resource\.data\.status == 'published';/);
    });

    it("does not grant an unconditional read", () => {
      expect(block()).not.toMatch(/allow read: if true;/);
    });

    it("keeps client writes disabled (Admin SDK only)", () => {
      expect(block()).toMatch(/allow write: if false;/);
    });
  });

  describe("/collections", () => {
    const block = () => matchBlock("collections");

    it("pins ownerId on update", () => {
      expect(block()).toMatch(
        /allow update: if request\.auth != null.*?request\.resource\.data\.ownerId == resource\.data\.ownerId/s,
      );
    });

    it("limits update to the app's collection fields", () => {
      const update = block().split("allow update:")[1] ?? "";
      expect(update).toMatch(/affectedKeys\(\)\.hasOnly\(\[/);
      expect(update).toContain("'name'");
      expect(update).toContain("'visibility'");
      expect(update).toContain("'posterIds'");
    });

    it("binds create to the caller and a known field set", () => {
      const create = block().split("allow create:")[1]?.split("allow update:")[0] ?? "";
      expect(create).toMatch(/request\.resource\.data\.ownerId == request\.auth\.uid/);
      expect(create).toMatch(/keys\(\)\.hasOnly\(\[/);
      expect(create).toMatch(/visibility in \['private', 'unlisted', 'public'\]/);
    });

    it("keeps private collections unreadable by non-owners", () => {
      const readClause = block().split("allow read:")[1]?.split("allow create:")[0] ?? "";
      expect(readClause).toMatch(/resource\.data\.ownerId == request\.auth\.uid/);
      expect(block()).not.toMatch(/allow read: if true;/);
    });
  });
});
