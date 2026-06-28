import { Client } from "@notionhq/client";
import { createServerFn } from "@tanstack/react-start";
import { type Poster } from "./posters";

const notion = new Client({ auth: process.env.NOTION_KEY || "" });
const databaseId = process.env.NOTION_DATABASE_ID || "";

export const fetchNotionPosters = createServerFn({ method: "POST" })
  .handler(async (): Promise<Poster[]> => {
    if (!process.env.NOTION_KEY || !process.env.NOTION_DATABASE_ID) {
      console.warn("NOTION_KEY or NOTION_DATABASE_ID missing.");
      return [];
    }

    try {
      // 1. Retrieve the database container to find the data sources inside it
      const db = await notion.databases.retrieve({
        database_id: databaseId,
      });

      const dataSources = (db as any).data_sources;
      if (!dataSources || dataSources.length === 0) {
        console.warn("No data sources found in the database.");
        return [];
      }

      // 2. Query the first data source
      const dataSourceId = dataSources[0].id;
      const response = await (notion as any).dataSources.query({
        data_source_id: dataSourceId,
        filter: {
          property: "Status",
          select: {
            equals: "Published",
          },
        },
      });

      return response.results.flatMap((page: any) => {
        const props = page.properties;
        const imageUrlProp = props["Image URL"];
        let imageUrls: string[] = [];

        if (imageUrlProp) {
          if (imageUrlProp.type === "url" && imageUrlProp.url) {
            imageUrls.push(imageUrlProp.url);
          } else if (imageUrlProp.type === "rich_text" && imageUrlProp.rich_text?.length > 0) {
            const text = imageUrlProp.rich_text[0].plain_text || "";
            imageUrls = text.split(/[\n,]+/).map((u: string) => u.trim()).filter(Boolean);
          } else if (imageUrlProp.type === "files" && imageUrlProp.files?.length > 0) {
            imageUrls = imageUrlProp.files.map((f: any) => f.file?.url || f.external?.url || "").filter(Boolean);
          }
        }

        if (imageUrls.length === 0) return [];

        const artistRaw = props.Artist?.rich_text[0]?.plain_text || "Unknown";
        const artistParts = artistRaw.split("|").map((s: string) => s.trim());

        let artistUrlRaw = "";
        const artistUrlProp = props["Artist URL"];
        if (artistUrlProp) {
          if (artistUrlProp.type === "url" && artistUrlProp.url) {
            artistUrlRaw = artistUrlProp.url;
          } else if (artistUrlProp.type === "rich_text" && artistUrlProp.rich_text?.length > 0) {
            artistUrlRaw = artistUrlProp.rich_text[0].plain_text || "";
          }
        }
        const artistUrlParts = artistUrlRaw.split("|").map((s: string) => s.trim());

        return imageUrls.map((url, index) => {
          // Resolve artist names/URLs for this specific image index
          const posterArtistRaw = artistParts[index] || artistParts[0] || "Unknown";
          const posterArtistUrlRaw = artistUrlParts[index] || artistUrlParts[0] || "";

          // Parse multiple artists within this poster (comma delimited)
          const artistNames = posterArtistRaw.split(/[,]+/).map((s: string) => s.trim()).filter(Boolean);
          const artistUrls = posterArtistUrlRaw.split(/[,]+/).map((s: string) => s.trim()).filter(Boolean);

          const artists = artistNames.map((name: string, i: number) => ({
            name,
            url: artistUrls[i] || undefined,
          }));

          const artistNamesJoined = artistNames.join(" & ");

          return {
            id: index === 0 ? page.id : `${page.id}-${index}`,
            title: props.Name?.title[0]?.plain_text || props.Title?.title[0]?.plain_text || "Untitled",
            year: props.Year?.number || 0,
            artists,
            artist: artistNamesJoined || "Unknown",
            artistUrl: artists[0]?.url || undefined,
            source: props.Source?.rich_text[0]?.plain_text || "Unknown",
            sourceUrl: props["Source URL"]?.url || "",
            image: url,
            style: props.Style?.select?.name || "Minimalist",
            genre: props.Genre?.multi_select?.map((g: any) => g.name) || [],
            tags: props.Tags?.multi_select?.map((t: any) => t.name) || [],
            note: props.Note?.rich_text[0]?.plain_text || undefined,
          };
        });
      });
    } catch (error) {
      console.error("Failed fetching from Notion:", error);
      return [];
    }
  });

export const getBase64Image = createServerFn({ method: "POST" })
  .validator((url: string) => url)
  .handler(async ({ data: url }): Promise<string> => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      console.error("Failed to proxy image:", error);
      throw error;
    }
  });

export const submitPosterToNotion = createServerFn({ method: "POST" })
  .validator((data: {
    role: "fan" | "artist";
    title: string;
    artistName: string;
    image: string;
    source: string;
    portfolio: string;
    socials: string;
    note: string;
    isCopyrightConfirmed: boolean;
  }) => data)
  .handler(async ({ data }): Promise<{ success: boolean; pageId: string }> => {
    if (!process.env.NOTION_KEY || !process.env.NOTION_DATABASE_ID) {
      throw new Error("NOTION_KEY or NOTION_DATABASE_ID environment variable is missing.");
    }

    // Define helper to build properties for a given title field key
    const buildProperties = (titleKey: string) => {
      const properties: any = {
        [titleKey]: {
          title: [
            {
              text: {
                content: data.title,
              },
            },
          ],
        },
        Status: {
          select: {
            name: "Review",
          },
        },
        Artist: {
          rich_text: [
            {
              text: {
                content: data.artistName || "Unknown",
              },
            },
          ],
        },
        "Image URL": {
          url: data.image,
        },
        Note: {
          rich_text: [
            {
              text: {
                content: [
                  data.note,
                  data.role === "artist"
                    ? `[Artist Submission]\nPortfolio: ${data.portfolio}\nSocials: ${data.socials}\nCopyright Confirmed: Yes`
                    : `[Fan Submission]\nSource: ${data.source}`
                ].filter(Boolean).join("\n\n"),
              },
            },
          ],
        },
      };

      if (data.role === "fan" && data.source) {
        properties["Source URL"] = {
          url: data.source,
        };
      } else if (data.role === "artist") {
        if (data.portfolio) {
          properties["Artist URL"] = {
            url: data.portfolio,
          };
        }
      }

      return properties;
    };

    // We will try extracting the first data source if it exists
    let targetDbId = databaseId;
    try {
      const db = await notion.databases.retrieve({
        database_id: databaseId,
      });
      const dataSources = (db as any).data_sources;
      if (dataSources && dataSources.length > 0) {
        targetDbId = dataSources[0].id;
      }
    } catch (e) {
      console.warn("Failed retrieving parent database container details. Using root databaseId:", e);
    }

    const tryCreate = async (dbId: string, titleKey: string) => {
      const properties = buildProperties(titleKey);
      return await notion.pages.create({
        parent: { database_id: dbId },
        properties,
      });
    };

    try {
      // 1. Try targetDbId (data source) with "Name"
      const response = await tryCreate(targetDbId, "Name");
      return { success: true, pageId: response.id };
    } catch (err1: any) {
      console.warn("Failed insertion with targetDbId/Name:", err1.message);
      
      // 2. Try targetDbId (data source) with "Title"
      try {
        const response = await tryCreate(targetDbId, "Title");
        return { success: true, pageId: response.id };
      } catch (err2: any) {
        console.warn("Failed insertion with targetDbId/Title:", err2.message);

        // 3. Fallback to root databaseId with "Name" if targetDbId is different and failed
        if (targetDbId !== databaseId) {
          try {
            const response = await tryCreate(databaseId, "Name");
            return { success: true, pageId: response.id };
          } catch (err3: any) {
            console.warn("Failed insertion with root databaseId/Name:", err3.message);

            // 4. Fallback to root databaseId with "Title"
            try {
              const response = await tryCreate(databaseId, "Title");
              return { success: true, pageId: response.id };
            } catch (err4: any) {
              console.error("Failed all insertion attempts:", err4);
              throw new Error(`Failed all insertion attempts. Final error: ${err4.message}`);
            }
          }
        } else {
          console.error("Failed insertion with both Title/Name on root database:", err2);
          throw new Error(`Failed insertion with both Title/Name keys. Error: ${err2.message}`);
        }
      }
    }
  });


