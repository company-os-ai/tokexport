/**
 * TokExport fulfillment: takes a TikTok handle, runs the Apify TikTok
 * Scraper actor, returns a CSV of recent videos with stats, captions, and
 * spoken transcripts.
 *
 * Two-mode design so the download endpoint can cache:
 *   - runFulfillment(input)        → runs the actor, returns { datasetId, csv }
 *   - csvFromDataset(datasetId)   → fetches an existing Apify dataset, returns csv
 */

const APIFY_ACTOR = "clockworks~tiktok-scraper";
const RESULTS_PER_HANDLE = 30;
const ACTOR_MEMORY_MB = 1024;
const SUBTITLE_FETCH_TIMEOUT_MS = 8000;

export type FulfillmentInput = {
  handle: string;
};

export type FulfillmentRun = {
  datasetId: string;
  csv: string;
  filename: string;
};

export async function runFulfillment(
  input: FulfillmentInput,
): Promise<FulfillmentRun> {
  const apiKey = requireKey();
  const handle = input.handle.replace(/^@/, "");

  const runUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${apiKey}&memory=${ACTOR_MEMORY_MB}`;
  const response = await fetch(runUrl, {
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

  const lastRun = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs/last?token=${apiKey}&status=SUCCEEDED`,
  );
  if (!lastRun.ok) {
    throw new Error(`Apify runs/last ${lastRun.status}`);
  }
  const lastRunBody = (await lastRun.json()) as { data: { defaultDatasetId: string } };
  const datasetId = lastRunBody.data.defaultDatasetId;

  const csv = await itemsToCsvWithTranscripts(items);

  return {
    datasetId,
    csv,
    filename: `${handle}-tokexport.csv`,
  };
}

export async function csvFromDataset(
  datasetId: string,
  handle: string,
): Promise<{ csv: string; filename: string }> {
  const apiKey = requireKey();
  const response = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&format=json`,
  );
  if (!response.ok) {
    throw new Error(
      `Apify dataset ${datasetId} fetch ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }
  const items = (await response.json()) as ApifyTikTokItem[];
  if (items.length === 0) {
    throw new Error(`Cached dataset ${datasetId} is empty (may have expired)`);
  }
  const csv = await itemsToCsvWithTranscripts(items);
  return {
    csv,
    filename: `${handle.replace(/^@/, "")}-tokexport.csv`,
  };
}

// --------------------------------------------------------------------------

async function itemsToCsvWithTranscripts(
  items: ApifyTikTokItem[],
): Promise<string> {
  // Fetch all subtitle texts in parallel. Each subtitleLinks[0] is the best
  // available English (or auto-generated) caption track. Failures don't
  // block the row — we just leave transcript blank for that video.
  const transcripts = await Promise.all(
    items.map((v) =>
      fetchTranscriptText(v.videoMeta?.subtitleLinks?.[0]?.downloadLink ?? null),
    ),
  );

  const header =
    "rank,date,url,views,likes,comments,shares,duration_sec,caption,transcript";
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
      csvEscape(transcripts[i]),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

async function fetchTranscriptText(url: string | null): Promise<string> {
  if (!url) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      SUBTITLE_FETCH_TIMEOUT_MS,
    );
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return "";
    const vtt = await res.text();
    return parseVttToText(vtt);
  } catch {
    return "";
  }
}

function parseVttToText(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t === "WEBVTT") return false;
      if (t.startsWith("NOTE")) return false;
      if (t.startsWith("STYLE")) return false;
      if (/^\d+$/.test(t)) return false;
      if (/-->/.test(t)) return false;
      return true;
    })
    .map((line) => line.trim())
    .join(" ");
}

function csvEscape(value: string): string {
  const cleaned = value.replace(/\r?\n/g, " ");
  if (cleaned.includes(",") || cleaned.includes('"')) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  return cleaned;
}

function requireKey(): string {
  const k = process.env.APIFY_API_KEY;
  if (!k) throw new Error("APIFY_API_KEY not set");
  return k;
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
    subtitleLinks?: Array<{
      language?: string;
      downloadLink?: string;
    }>;
  };
};
