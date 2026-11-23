/**
 * Signing in to an MCP server that asks for it in the browser: the OAuth 2.1
 * authorization-code flow with PKCE, as the MCP specification lays it out.
 * The server says where its authorization server is, this app registers itself
 * there as a public client, the user signs in on the provider's own page, and
 * the code that comes back is exchanged for tokens. No password passes through
 * this app.
 */
import { createHash, randomBytes } from "node:crypto";

const TIMEOUT_MS = 20_000;

/** What is kept after a sign-in, with the connector's other secrets. */
export interface OAuthGrant {
  accessToken: string;
  refreshToken: string | null;
  /** ISO time after which the access token is no good; null when the server did not say. */
  expiresAt: string | null;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  /** The server the tokens are for. */
  resource: string;
}

/** A sign-in the user has been sent off to finish in the browser. */
export interface PendingSignIn {
  verifier: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  resource: string;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** An address a browser or this app may be sent to: https, or http on this machine. */
function safe(url: string | null, what: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error(`The server gave no usable ${what}.`);
  }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error(`The server's ${what} is not a secure address.`);
  }
  return parsed.toString();
}

/** Where the server's metadata says to look, trying the well-known places in the order the specification gives. */
async function discover(serverUrl: string) {
  const server = new URL(serverUrl);
  // Ask without a token: the refusal says where the description of the resource is.
  let hinted: string | null = null;
  let scope: string | null = null;
  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "losperitos", version: "1" } } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const challenge = response.headers.get("www-authenticate") ?? "";
    hinted = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? null;
    scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? null;
    if (response.ok) throw new Error("This server does not ask for a sign-in.");
  } catch (err) {
    if ((err as Error).message.startsWith("This server")) throw err;
    throw new Error("The server could not be reached.");
  }
  const path = server.pathname.replace(/\/$/, "");
  const resource =
    (hinted && (await getJson(hinted))) ||
    (await getJson(`${server.origin}/.well-known/oauth-protected-resource${path}`)) ||
    (await getJson(`${server.origin}/.well-known/oauth-protected-resource`));
  const issuers = resource?.authorization_servers;
  // Servers older than the resource description are their own authorization server.
  const issuer = new URL(Array.isArray(issuers) && typeof issuers[0] === "string" ? issuers[0] : server.origin);
  const issuerPath = issuer.pathname.replace(/\/$/, "");
  const meta =
    (await getJson(`${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`)) ||
    (await getJson(`${issuer.origin}${issuerPath}/.well-known/openid-configuration`)) ||
    (await getJson(`${issuer.origin}/.well-known/openid-configuration${issuerPath}`));
  if (!meta) throw new Error("The server does not say how to sign in to it.");
  const scopes = Array.isArray(resource?.scopes_supported) ? resource.scopes_supported.filter((s) => typeof s === "string") : [];
  return {
    resource: text(resource?.resource) ?? serverUrl,
    authorizationEndpoint: safe(text(meta.authorization_endpoint), "sign-in page"),
    tokenEndpoint: safe(text(meta.token_endpoint), "token address"),
    registrationEndpoint: text(meta.registration_endpoint),
    scope: scope ?? (scopes.length ? scopes.join(" ") : null),
  };
}

/**
 * Prepare a sign-in: find the authorization server, register this app with
 * it, and build the page the user's browser should open.
 */
export async function beginSignIn(serverUrl: string, redirectUri: string, state: string): Promise<{ url: string; pending: PendingSignIn }> {
  const found = await discover(serverUrl);
  if (!found.registrationEndpoint) {
    throw new Error("This server wants an app registered with it by hand, which is not supported yet.");
  }
  const registered = await fetch(safe(found.registrationEndpoint, "registration address"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "LosPeritos",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const client = (registered.ok ? await registered.json().catch(() => null) : null) as Record<string, unknown> | null;
  const clientId = text(client?.client_id);
  if (!clientId) throw new Error("The server would not register this app.");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL(found.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("resource", found.resource);
  if (found.scope) url.searchParams.set("scope", found.scope);
  return {
    url: url.toString(),
    pending: {
      verifier,
      tokenEndpoint: found.tokenEndpoint,
      clientId,
      clientSecret: text(client?.client_secret),
      redirectUri,
      resource: found.resource,
    },
  };
}

async function token(endpoint: string, fields: Record<string, string>, now: Date, base: Omit<OAuthGrant, "accessToken" | "refreshToken" | "expiresAt">, keep: string | null): Promise<OAuthGrant> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = text(json?.access_token);
  if (!response.ok || !accessToken) {
    throw new Error(text(json?.error_description) ?? text(json?.error) ?? "The server did not give a token.");
  }
  const seconds = typeof json?.expires_in === "number" ? json.expires_in : null;
  return {
    ...base,
    accessToken,
    // A server that does not send a new refresh token means the old one still stands.
    refreshToken: text(json?.refresh_token) ?? keep,
    expiresAt: seconds ? new Date(now.getTime() + seconds * 1000).toISOString() : null,
  };
}

/** Trade the code the browser came back with for tokens. */
export function finishSignIn(pending: PendingSignIn, code: string, now: Date): Promise<OAuthGrant> {
  const { tokenEndpoint, clientId, clientSecret, resource } = pending;
  return token(
    tokenEndpoint,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: clientId,
      code_verifier: pending.verifier,
      resource,
      ...(clientSecret && { client_secret: clientSecret }),
    },
    now,
    { tokenEndpoint, clientId, clientSecret, resource },
    null,
  );
}

/** A fresh access token from the refresh token. */
export function refresh(grant: OAuthGrant, now: Date): Promise<OAuthGrant> {
  if (!grant.refreshToken) throw new Error("The sign-in has run out; sign in again.");
  const { tokenEndpoint, clientId, clientSecret, resource } = grant;
  return token(
    tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
      client_id: clientId,
      resource,
      ...(clientSecret && { client_secret: clientSecret }),
    },
    now,
    { tokenEndpoint, clientId, clientSecret, resource },
    grant.refreshToken,
  );
}
