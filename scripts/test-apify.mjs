/**
 * One-shot probe: hits Apify's TikTok Scraper for a single handle and prints
 * the response shape so we can build the CSV mapper against real data.
 *
 * Usage:
 *   APIFY_API_KEY=... node scripts/test-apify.mjs <handle> [results=5]
 */

const apiKey = process.env.APIFY_API_KEY;
if (!apiKey) {
  console.error("APIFY_API_KEY not set");
  process.exit(1);
}

const handle = (process.argv[2] ?? "mrbeast").replace(/^@/, "");
const resultsPerPage = Number(process.argv[3] ?? "5");

console.log(`Probing Apify for @${handle} (${resultsPerPage} videos)...`);

// clockworks/tiktok-scraper — actor ID uses ~ instead of /
const actorId = "clockworks~tiktok-scraper";
const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}`;

const input = {
  profiles: [handle],
  resultsPerPage,
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadSubtitles: false,
  shouldDownloadAvatars: false,
  shouldDownloadSlideshowImages: false,
};

const start = Date.now();
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
});
const elapsed = Date.now() - start;

console.log(`Status: ${response.status} (${elapsed}ms)`);

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

const items = await response.json();
console.log(`Got ${items.length} items.`);
console.log("");
console.log("=== First item (full shape) ===");
console.log(JSON.stringify(items[0], null, 2));
