// Checks how far "Sign in" gets with each hosted connector template, without an
// account: the app finds the server's sign-in description, makes itself known
// to it, and asks for the sign-in page. Nothing is signed in to. Each run that
// registers leaves one unused client registration at the provider.
// Run `npm run build` first.
import { randomBytes } from "node:crypto";
import { beginSignIn } from "../packages/core/dist/oauth.js";

const servers = {
  fal: "https://mcp.fal.ai/mcp-relay",
  Higgsfield: "https://mcp.higgsfield.ai/mcp",
  Runway: "https://mcp.runwayml.com/mcp",
  Kling: "https://kling.ai/mcp",
  ElevenLabs: "https://api.elevenlabs.io/v1/mcp",
  "Meta Ads": "https://mcp.facebook.com/ads",
};
const only = process.argv.slice(2);
for (const [name, url] of Object.entries(servers)) {
  if (only.length && !only.includes(name)) continue;
  try {
    const { url: page } = await beginSignIn(url, "http://127.0.0.1:7423/oauth/callback", randomBytes(16).toString("hex"));
    const target = new URL(page);
    // Ask for the page as a browser would, without following it: a refusal of the client or the callback shows here.
    const answer = await fetch(page, { redirect: "manual", headers: { Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
    const next = answer.headers.get("location");
    const where = next ? new URL(next, page) : null;
    const refused = where?.searchParams.get("error") ?? (answer.status >= 400 ? `HTTP ${answer.status}` : null);
    console.log(`${name}: sign-in page at ${target.host}${target.pathname} → ${answer.status}${where ? ` → ${where.host}${where.pathname}` : ""}${refused ? `  REFUSED: ${refused} ${where?.searchParams.get("error_description") ?? ""}` : "  ok"}`);
  } catch (err) {
    console.log(`${name}: FAILED before the sign-in page: ${err.message}`);
  }
}
