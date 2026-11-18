import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression tripwire for the print-popup DOM XSS (security audit run 1).
 *
 * What happened: ShareModal.handlePrint built a whole HTML document as a
 * template literal and assigned it with `printWindow.document.write(...)`,
 * interpolating `poster.title` directly into `<title>`. A published title
 * containing `</title><script>...` therefore escaped the RCDATA title element
 * and executed same-origin in the popup, with `window.opener` still pointing
 * at the app. React escaping in the gallery gave no protection because the
 * payload never went through JSX.
 *
 * Invariant under test:
 *
 *   Catalogue text is only ever assigned to the print document as a text node
 *   or a property (`doc.title`, `textContent`, `alt`, `src`). It is never
 *   concatenated into a string that the HTML parser consumes, and the popup
 *   never keeps an opener reference.
 *
 * Why a source scan: this component has no DOM test environment in the repo,
 * and the defect is a single parse-context choice. Banning the constructs that
 * reintroduce it is cheaper and stricter than asserting on rendered output.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = fs.readFileSync(path.join(repoRoot, "src/components/ShareModal.tsx"), "utf8");

function handlePrintBody(): string {
  const start = source.indexOf("const handlePrint = () => {");
  expect(start, "handlePrint must exist in ShareModal.tsx").toBeGreaterThan(-1);
  const end = source.indexOf("\n  };", start);
  expect(end, "handlePrint must be a complete arrow function").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("ShareModal print popup", () => {
  it("never writes an HTML string into the popup document", () => {
    const body = handlePrintBody();
    expect(body).not.toMatch(/\.document\.write\s*\(/);
    expect(body).not.toMatch(/\.document\.writeln\s*\(/);
    expect(body).not.toMatch(/innerHTML\s*=/);
    expect(body).not.toMatch(/insertAdjacentHTML\s*\(/);
    expect(body).not.toMatch(/outerHTML\s*=/);
  });

  it("assigns the poster title as text, not as markup", () => {
    const body = handlePrintBody();
    expect(body).toMatch(/doc\.title\s*=\s*`Print CinePrint Ticket - \$\{poster\.title\}`/);
    // The title must not be interpolated into a string that starts a tag.
    expect(body).not.toMatch(/<title>[^`]*\$\{poster\.title\}/);
  });

  it("builds the ticket image with DOM APIs and a listener, not inline handlers", () => {
    const body = handlePrintBody();
    expect(body).toMatch(/doc\.createElement\("img"\)/);
    expect(body).toMatch(/addEventListener\("load"/);
    expect(body).not.toMatch(/onload\s*=/);
  });

  it("drops the popup's opener reference", () => {
    const body = handlePrintBody();
    expect(body).toMatch(/printWindow\.opener\s*=\s*null/);
  });
});
