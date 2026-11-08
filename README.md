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

The first run opens a two-step setup. Step 1 connects NetSuite and runs a test read. Step 2 connects an AI model and sends a test message. You can skip step 2: the NetSuite screens work without a model, and Ask stays off until you connect one. Settings reopens either step.

Step 1 offers two connections. Both expose the same `ns_*` tools.

- NetSuite OAuth. Enter the account ID and the integration's client ID, and pick a public or confidential client. A confidential client also needs its secret. This login uses only the `mcp` scope, through the AI Connector.
- Custom MCP server, with a URL and a bearer token. Use it for OpenSuiteMCP (hosted at `https://app.opensuitemcp.com/api/mcp`, or self-hosted), Mint, or any other host of the NetSuite tools.

## Models

Ask can use Claude, Grok, Gemini, OpenAI, Groq, Mistral, or an OpenAI-compatible host. Step 2 lists the models from the provider's own model list. Saved keys live in `data/models.json`.

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
