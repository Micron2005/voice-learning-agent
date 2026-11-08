import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidRequestError,
  InvalidScopeError,
  UnsupportedGrantTypeError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { Store, requireThat } from "./store.js";
import { hash, opaque } from "./auth.js";

export const SCOPES = [
  "voice:read",
  "voice:preview",
  "calls:read",
  "calls:prepare",
  "calls:place",
  "calls:stop",
];
export class OAuthProvider implements OAuthServerProvider {
  resource: string;
  constructor(
    public store: Store,
    public origin: string,
  ) {
    this.resource = `${origin}/mcp`;
  }
  clientsStore = {
    getClient: (id: string): OAuthClientInformationFull | undefined => {
      const row = this.store.db
        .prepare("SELECT data FROM oauth_clients WHERE id=?")
        .get(id);
      return row ? JSON.parse(row.data as string) : undefined;
    },
    registerClient: (
      client: Omit<
        OAuthClientInformationFull,
        "client_id" | "client_id_issued_at"
      >,
    ): OAuthClientInformationFull => {
      if (client.token_endpoint_auth_method !== "none")
        throw new InvalidRequestError(
          "Only public PKCE clients with token_endpoint_auth_method=none are supported.",
        );
      for (const uri of client.redirect_uris) {
        const u = new URL(uri);
        if (
          u.username ||
          u.password ||
          u.hash ||
          !(
            u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
          )
        )
          throw new InvalidRequestError("Use HTTPS or loopback redirect URIs.");
      }
      const full = {
        ...client,
        client_id: opaque(),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        grant_types: ["authorization_code"],
        response_types: ["code"],
      };
      this.store.db
        .prepare("INSERT INTO oauth_clients VALUES (?,?)")
        .run(full.client_id, JSON.stringify(full));
      return full;
    },
  };
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    if (params.resource?.href !== this.resource)
      throw new InvalidRequestError(
        "The exact MCP resource parameter is required.",
      );
    if (
      !params.scopes?.length ||
      params.scopes.some((s) => !SCOPES.includes(s))
    )
      throw new InvalidScopeError("Request explicit supported scopes.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
      throw new InvalidRequestError("S256 PKCE required.");
    const request = opaque();
    this.store.db.prepare("INSERT INTO oauth_codes VALUES (?,?,?)").run(
      hash(request),
      JSON.stringify({
        type: "request",
        clientId: client.client_id,
        clientName: client.client_name ?? "MCP client",
        ...params,
        resource: this.resource,
      }),
      Date.now() + 300_000,
    );
    res.redirect(`/?oauth=${request}`);
  }
  pending(request: string) {
    const row = this.store.db
      .prepare("SELECT data FROM oauth_codes WHERE hash=? AND expires>?")
      .get(hash(request), Date.now());
    requireThat(
      row,
      "oauth_expired",
      "Connection request expired. Start again.",
      400,
    );
    const p = JSON.parse(row.data as string);
    requireThat(
      p.type === "request",
      "oauth_request",
      "Invalid connection request.",
    );
    return p;
  }
  approve(owner: string, request: string, approve: boolean) {
    return this.store.atomic(() => {
      const p = this.pending(request),
        redirect = new URL(p.redirectUri);
      this.store.db
        .prepare("DELETE FROM oauth_codes WHERE hash=?")
        .run(hash(request));
      if (approve) {
        const code = opaque();
        this.store.db
          .prepare("INSERT INTO oauth_codes VALUES (?,?,?)")
          .run(
            hash(code),
            JSON.stringify({ ...p, type: "code", owner }),
            Date.now() + 60_000,
          );
        redirect.searchParams.set("code", code);
      } else redirect.searchParams.set("error", "access_denied");
      if (p.state) redirect.searchParams.set("state", p.state);
      redirect.searchParams.set("iss", this.origin);
      this.store.audit(
        owner,
        approve ? "oauth.approved" : "oauth.denied",
        p.clientId,
      );
      return redirect.href;
    });
  }
  code(client: OAuthClientInformationFull, code: string) {
    const row = this.store.db
      .prepare("SELECT data FROM oauth_codes WHERE hash=? AND expires>?")
      .get(hash(code), Date.now());
    if (!row) throw new InvalidGrantError("Code invalid or expired.");
    const p = JSON.parse(row.data as string);
    if (p.type !== "code" || p.clientId !== client.client_id)
      throw new InvalidGrantError("Code binding mismatch.");
    return p;
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    return this.code(client, code).codeChallenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    verifier?: string,
    redirect?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    return this.store.atomic(() => {
      const p = this.code(client, code);
      // The SDK validates S256 before exchange and deliberately omits its validated verifier.
      if (
        (verifier &&
          Buffer.from(hashBytes(verifier)).toString("base64url") !==
            p.codeChallenge) ||
        redirect !== p.redirectUri ||
        resource?.href !== p.resource
      )
        throw new InvalidGrantError("PKCE, redirect or resource mismatch.");
      this.store.db
        .prepare("DELETE FROM oauth_codes WHERE hash=?")
        .run(hash(code));
      const token = opaque();
      this.store.db
        .prepare("INSERT INTO oauth_tokens VALUES (?,?,?,?,?)")
        .run(
          hash(token),
          p.owner,
          JSON.stringify({ clientId: client.client_id, scopes: p.scopes }),
          this.resource,
          Date.now() + 3600_000,
        );
      return {
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: p.scopes.join(" "),
      };
    });
  }
  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new UnsupportedGrantTypeError(
      "Reconnect after the one-hour access token expires.",
    );
  }
  async verifyAccessToken(token: string) {
    const row = this.store.db
      .prepare("SELECT * FROM oauth_tokens WHERE hash=? AND expires>?")
      .get(hash(token), Date.now());
    if (!row || row.resource !== this.resource)
      throw new InvalidTokenError("Invalid or expired token.");
    const p = JSON.parse(row.scopes as string);
    return {
      token,
      clientId: p.clientId,
      scopes: p.scopes as string[],
      resource: new URL(this.resource),
      expiresAt: Math.floor((row.expires as number) / 1000),
      extra: { owner: row.owner },
    };
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: { token: string },
  ) {
    const row = this.store.db
      .prepare("SELECT scopes FROM oauth_tokens WHERE hash=?")
      .get(hash(request.token));
    if (row && JSON.parse(row.scopes as string).clientId === client.client_id)
      this.store.db
        .prepare("DELETE FROM oauth_tokens WHERE hash=?")
        .run(hash(request.token));
  }
}
function hashBytes(s: string) {
  return Buffer.from(hash(s), "hex");
}
