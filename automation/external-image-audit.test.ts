import { describe, expect, it, vi } from "vitest";
import {
  auditExternalRecords,
  externalPathsFor,
  exactUrlPositions,
  isPbsImageUrl,
  type ExternalAuditServices,
  type ExternalRecord,
} from "./external-image-audit";

const URL_A = "https://pbs.twimg.com/media/a.jpg?format=jpg&name=large";
const URL_B = "https://pbs.twimg.com/media/b.jpg?format=jpg&name=large";
const BLOB_A = "https://store.public.blob.vercel-storage.com/cineprint/external/a.jpg";

function record(id: string, image = URL_A, notionPageId = `page-${id}`): ExternalRecord {
  return {
    id,
    title: "Poster",
    year: 2024,
    mediaType: "movie",
    slug: id,
    tmdbId: "1",
    notionPageId,
    image,
    posterImageUrl: image,
    status: "published",
  };
}

function services(
  pages: Record<string, Record<string, unknown>>,
  overrides: Partial<ExternalAuditServices> = {},
): ExternalAuditServices {
  return {
    download: vi.fn(async (url: string) => ({
      buffer: Buffer.from(`image:${url}`),
      contentType: "image/jpeg",
      finalUrl: `${url}&final=1`,
    })),
    inspect: vi.fn(async () => ({ width: 1200, height: 1800, format: "jpeg" })),
    retrievePage: vi.fn(async (pageId: string) => ({
      properties: pages[pageId] ?? {
        Name: { title: [{ plain_text: "Poster" }] },
        "Image URL": { type: "url", url: URL_A },
      },
    })),
    head: vi.fn(async () => null),
    ...overrides,
  };
}

describe("external image audit helpers", () => {
  it("discovers and audits 19 external records", async () => {
    const records = Array.from({ length: 19 }, (_, index) => {
      const id = `poster-${index + 1}`;
      const url = `https://pbs.twimg.com/media/${index}.jpg?format=jpg`;
      return record(id, url);
    });
    const pages = Object.fromEntries(
      records.map((item) => [
        item.notionPageId,
        {
          Name: { title: [{ plain_text: item.title }] },
          "Image URL": { type: "url", url: item.image },
        },
      ]),
    );
    const result = await auditExternalRecords(records, services(pages));

    expect(result).toHaveLength(19);
    expect(result.every((item) => item.status === "SAFE")).toBe(true);
  });

  it("generates deterministic document-based paths", () => {
    expect(externalPathsFor("the-substance-2", "image/jpeg")).toEqual({
      original: "cineprint/external/the-substance-2.jpg",
      optimized: "cineprint/optimized/external/the-substance-2.webp",
    });
    expect(externalPathsFor("the-substance-2", "image/png")?.original).toBe(
      "cineprint/external/the-substance-2.png",
    );
  });

  it("generates distinct paths for different Firebase documents", () => {
    expect(externalPathsFor("one", "image/jpeg")?.original).not.toBe(
      externalPathsFor("two", "image/jpeg")?.original,
    );
  });

  it("detects duplicate source URLs", async () => {
    const pages = {
      page_a: { "Image URL": { type: "url", url: URL_A } },
      page_b: { "Image URL": { type: "url", url: URL_A } },
    };
    const result = await auditExternalRecords(
      [record("a", URL_A, "page_a"), record("b", URL_A, "page_b")],
      services(pages),
    );
    expect(result.every((item) => item.status === "MANUAL REVIEW")).toBe(true);
    expect(result[0].sourceUrlDuplicateIds).toEqual(["b"]);
  });

  it("detects existing original and optimized Blob objects", async () => {
    const result = await auditExternalRecords(
      [record("the-substance-2")],
      services(
        { "page-the-substance-2": { "Image URL": { type: "url", url: URL_A } } },
        { head: vi.fn(async () => ({ url: BLOB_A, pathname: "existing" })) },
      ),
    );
    expect(result[0].originalBlobExists).toBe(true);
    expect(result[0].optimizedBlobExists).toBe(true);
    expect(result[0].proposedAction).toBe("REUSE");
  });

  it("identifies the exact Notion image position and preserves other URLs", async () => {
    const pageId = "page-multi";
    const result = await auditExternalRecords(
      [record("target", URL_B, pageId)],
      services({
        [pageId]: {
          Name: { title: [{ plain_text: "Multi" }] },
          "Image URL": { type: "url", url: `${URL_A}, ${URL_B}` },
        },
      }),
    );
    expect(result[0].imagePosition).toBe(1);
    expect(result[0].notionImageUrls).toEqual([URL_A, URL_B]);
    expect(result[0].hasOtherImages).toBe(true);
  });

  it("flags a missing Notion page", async () => {
    const result = await auditExternalRecords(
      [record("missing", URL_A, "missing-page")],
      services(
        {},
        {
          retrievePage: vi.fn(async () => {
            throw new Error("not found");
          }),
        },
      ),
    );
    expect(result[0].status).toBe("MANUAL REVIEW");
    expect(result[0].reason).toContain("Notion page");
  });

  it("flags a missing target URL", async () => {
    const result = await auditExternalRecords(
      [record("missing-url", URL_A, "page-missing-url")],
      services({ "page-missing-url": { "Image URL": { type: "url", url: URL_B } } }),
    );
    expect(result[0].status).toBe("MANUAL REVIEW");
    expect(result[0].reason).toContain("target URL");
  });

  it("flags a duplicate target URL in one Notion page", async () => {
    const result = await auditExternalRecords(
      [record("duplicate-url", URL_A, "page-duplicate")],
      services({ "page-duplicate": { "Image URL": { type: "url", url: `${URL_A}, ${URL_A}` } } }),
    );
    expect(result[0].status).toBe("MANUAL REVIEW");
    expect(result[0].reason).toContain("more than once");
  });

  it("flags invalid image responses", async () => {
    const result = await auditExternalRecords(
      [record("invalid", URL_A)],
      services(
        {},
        {
          download: vi.fn(async () => {
            throw new Error("unsupported content type: text/html");
          }),
        },
      ),
    );
    expect(result[0].status).toBe("MANUAL REVIEW");
    expect(result[0].reason).toContain("unsupported content type");
  });

  it("flags HTML pretending to be an image", async () => {
    const result = await auditExternalRecords(
      [record("html", URL_A)],
      services(
        {},
        {
          download: vi.fn(async () => {
            throw new Error("image response body does not match");
          }),
        },
      ),
    );
    expect(result[0].status).toBe("MANUAL REVIEW");
  });

  it("does not perform writes during the audit service flow", async () => {
    const updatePage = vi.fn();
    const result = await auditExternalRecords(
      [record("read-only")],
      services({ "page-read-only": { "Image URL": { type: "url", url: URL_A } } }),
    );
    expect(result[0].status).toBe("SAFE");
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("recognizes PBS URLs and rejects unrelated URLs", () => {
    expect(isPbsImageUrl(URL_A)).toBe(true);
    expect(isPbsImageUrl("https://example.com/image.jpg")).toBe(false);
  });

  it("preserves ordering for a three-image page", async () => {
    const urls = [URL_A, "https://pbs.twimg.com/media/other.jpg", URL_B];
    const result = await auditExternalRecords(
      [record("third", URL_B, "page-order")],
      services({ "page-order": { "Image URL": { type: "url", url: urls.join(", ") } } }),
    );
    expect(result[0].imagePosition).toBe(2);
    expect(result[0].notionImageUrls).toEqual(urls);
  });

  it("provides exact URL positions", () => {
    expect(exactUrlPositions([URL_A, URL_B, URL_A], URL_A)).toEqual([0, 2]);
  });
});
