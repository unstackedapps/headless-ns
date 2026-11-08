# headless-ns

A browser client for the standard NetSuite MCP tools.

## Non-negotiables

- NetSuite stays the system of record.
- The page never holds a NetSuite token or a model key.
- A local server calls the tools and the model.
- The browser keeps only an httpOnly session cookie.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open https://localhost:5173. The first run uses a certificate in `certs/`, which git ignores.

## Connect

Settings can use one of three hosts. Each one exposes the same `ns_*` tools.

- OpenSuiteMCP, with a bearer token from an agent app.
- NetSuite itself. This login uses only the `mcp` scope, through the AI Connector. It is a different sign-in from REST Web Services.
- Another MCP host, such as Mint, with a URL and a bearer token.

Setup steps for each host are on the Settings page.

## Models

Ask can use Claude, Grok, Gemini, OpenAI, Groq, Mistral, or an OpenAI-compatible host. Saved keys live in `data/models.json`.

## Check

```bash
npm test
```

Screen tests click through the app in Chromium with NetSuite's answers faked. Start `npm run dev` first; they use https://localhost:5173.

```bash
npm run e2e
```

Live tests run the same screens against NetSuite and save screenshots to `e2e/shots`. `order-to-cash.live.ts` creates a quote, sales order, fulfillment, invoice and payment with the memo "headless-ns workflow test". Sign in once in a browser first.

```bash
npm run e2e:live
```

The first run needs `npx playwright install chromium`.
