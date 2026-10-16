import { createTranscribeHandlers } from "../../../lib/api/transcribe-handler";

// Server-only: ELEVENLABS_API_KEY is read from process.env and never sent to the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createTranscribeHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
