/**
 * TokExport fulfillment: takes a TikTok handle, runs the Apify TikTok
 * Scraper actor, returns a CSV of recent videos with stats and captions.
 */

export type FulfillmentInput = {
  handle: string;
};

export type FulfillmentOutput = {
  filename: string;
  contentType: string;
  body: string | Buffer;
};

const APIFY_ACTOR_ID = "clockworks~tiktok-scraper";
const RESULTS_PER_HANDLE = 30;

export async function fulfill(
  input: FulfillmentInput,
): Promise<FulfillmentOutput> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new Error("APIFY_API_KEY not set");
  }

  const handle = input.handle.replace(/^@/, "");

  // memory=1024 keeps us under Apify's free-tier 8GB concurrent cap.
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${apiKey}&memory=1024`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profiles: [handle],
      resultsPerPage: RESULTS_PER_HANDLE,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadAvatars: false,
      shouldDownloadSlideshowImages: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Apify ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }

  const items = (await response.json()) as ApifyTikTokItem[];

  if (items.length === 0) {
    throw new Error(
      `No videos found for @${handle} — account may be private or invalid.`,
    );
  }

  const header =
    "rank,date,url,views,likes,comments,shares,duration_sec,caption";
  const rows = items.map((v, i) =>
    [
      i + 1,
      v.createTimeISO ?? "",
      v.webVideoUrl ?? "",
      v.playCount ?? 0,
      v.diggCount ?? 0,
      v.commentCount ?? 0,
      v.shareCount ?? 0,
      v.videoMeta?.duration ?? 0,
      csvEscape(v.text ?? ""),
    ].join(","),
  );
  const csv = [header, ...rows].join("\n");

  return {
    filename: `${handle}-tokexport.csv`,
    contentType: "text/csv; charset=utf-8",
    body: csv,
  };
}

function csvEscape(value: string): string {
  const cleaned = value.replace(/\r?\n/g, " ");
  if (cleaned.includes(",") || cleaned.includes('"')) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  return cleaned;
}

type ApifyTikTokItem = {
  id?: string;
  text?: string;
  createTimeISO?: string;
  webVideoUrl?: string;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  videoMeta?: {
    duration?: number;
  };
};
