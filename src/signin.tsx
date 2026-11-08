import { ConnectionPanel } from "./connect";
import { Glyph, glyph } from "./icons";

type Discovery = {
  issuer: string;
  scopes: string[];
  signingKeys: number;
  jwksError: string | null;
  fetchedAt: string;
};

export type SessionInfo = {
  configured: boolean;
  accountId: string;
  accountMissing: boolean;
  redirectUri: string;
  ephemeralSecret: boolean;
  discovery: Discovery | null;
  discoveryError: string | null;
  signedIn: boolean;
  via: "osmcp" | "opensuitemcp" | "custom" | "netsuite" | "oidc" | null;
  roleId: string | null;
  email: string | null;
  expiresAt: string | null;
  osmcpError: string | null;
};

export function SignIn({ session, authError }: { session: SessionInfo; authError: string | null }) {
  return (
    <main className="signin">
      <section className="card">
        <img className="mark" src="/favicon.svg" alt="" width="28" height="28" />
        <h1>headless-ns</h1>
        <p className="lede">Choose how to reach NetSuite. The browser never holds the token.</p>
        <ConnectionPanel />
        <h2>SuiteTalk sign-in</h2>
        {session.osmcpError && <p className="error">{session.osmcpError}</p>}
        {authError && <p className="error">{authError}</p>}
        {session.accountMissing ? (
          <p className="note">Add the account ID under Connection to sign in.</p>
        ) : session.discovery ? (
          <p className="live-line">
            Account <strong>{session.accountId.toUpperCase()}</strong> is ready to sign in.
          </p>
        ) : (
          <p className="error">{session.discoveryError || "NetSuite did not answer the sign-in check."}</p>
        )}
        <ol className="steps">
          <li>The role you sign in with needs the Setup permission Log in using OAuth 2.0 Access Tokens.</li>
          <li>
            Go to Setup &gt; Integration &gt; Manage Integrations &gt; New. Name it headless-ns and set State to Enabled.
            Under Authentication, check Authorization Code Grant and REST Web Services. Leave Public Client and Client
            Credentials unchecked. Save, then copy the client ID and client secret into <code>.env</code>. NetSuite shows
            them once.
            <span className="uri">{session.redirectUri}</span>
          </li>
          <li>
            Go to Setup &gt; Integration &gt; Manage Authentication &gt; NetSuite as OIDC Provider Setup. Open the
            integration and enable both your entity and your role.
          </li>
          <li>Restart the server, then use Sign in with NetSuite.</li>
        </ol>
        <div className="actions">
          {session.configured && !session.accountMissing ? (
            <a className="primary" href="/api/auth/login">
              <Glyph icon={glyph.signIn} />
              Sign in with NetSuite
            </a>
          ) : (
            <button className="primary" type="button" disabled>
              Sign in with NetSuite
            </button>
          )}
          {!session.configured && <span className="note">Add NETSUITE_CLIENT_ID to .env.</span>}
        </div>
        {session.ephemeralSecret && (
          <p className="note">Add SESSION_SECRET to .env so the local session survives a restart.</p>
        )}
      </section>
    </main>
  );
}
