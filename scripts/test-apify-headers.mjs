/**
 * Probes which headers Apify's run-sync endpoint sends back, so we know
 * how to grab the dataset_id for caching.
 */

const apiKey = process.env.APIFY_API_KEY;
if (!apiKey) {
  console.error("APIFY_API_KEY not set");
  process.exit(1);
}

const url = `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${apiKey}&memory=1024`;

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    profiles: ["mrbeast"],
    resultsPerPage: 1,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  }),
});

console.log(`Status: ${response.status}`);
console.log("Headers:");
for (const [k, v] of response.headers.entries()) {
  if (k.toLowerCase().startsWith("x-apify") || k === "location") {
    console.log(`  ${k}: ${v}`);
  }
}
