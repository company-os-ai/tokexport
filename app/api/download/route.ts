import { NextResponse } from "next/server";
import { getStripe, verifyPaidSession } from "@/lib/stripe";
import { runFulfillment, csvFromDataset } from "@/lib/fulfillment";

export const runtime = "nodejs";
export const maxDuration = 60;

const APIFY_DATASET_METADATA_KEY = "apify_dataset_id";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "missing session_id" }, { status: 400 });
  }

  let session;
  try {
    session = await verifyPaidSession(sessionId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "session check failed" },
      { status: 402 },
    );
  }

  let csv: string;
  let filename: string;

  const cachedDatasetId = session.metadata?.[APIFY_DATASET_METADATA_KEY];

  if (cachedDatasetId) {
    try {
      const result = await csvFromDataset(cachedDatasetId, session.handle);
      csv = result.csv;
      filename = result.filename;
    } catch (err) {
      console.warn(
        `Cached dataset ${cachedDatasetId} unusable, re-running:`,
        err,
      );
      const fresh = await runAndCache(sessionId, session.handle);
      csv = fresh.csv;
      filename = fresh.filename;
    }
  } else {
    try {
      const fresh = await runAndCache(sessionId, session.handle);
      csv = fresh.csv;
      filename = fresh.filename;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "fulfillment failed" },
        { status: 500 },
      );
    }
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function runAndCache(sessionId: string, handle: string) {
  const result = await runFulfillment({ handle });

  // Save dataset_id to Stripe session metadata so subsequent download clicks
  // skip the actor run and read the dataset directly. Best-effort — if our
  // Stripe key lacks write scope, we silently degrade to "no cache".
  try {
    await getStripe().checkout.sessions.update(sessionId, {
      metadata: { [APIFY_DATASET_METADATA_KEY]: result.datasetId },
    });
  } catch (err) {
    console.warn(
      "Could not write apify_dataset_id to Stripe session metadata:",
      err,
    );
  }

  return result;
}
