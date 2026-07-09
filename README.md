# Scour

Consumer web app that searches multiple retailers/marketplaces for the cheapest reliable price on a specific auto part. See [`parts-hunter-project-brief.md`](./parts-hunter-project-brief.md) for full product scope, architecture, and data sources, and [`index.html`](./index.html) for the visual/interaction reference prototype.

**Status:** Pre-development / API access pending.

## Repo layout

- `index.html` — standalone HTML/CSS prototype establishing the visual identity (also serves as the site root for deployment)
- `parts-hunter-project-brief.md` — product brief and technical spec
- `backend/` — Node.js API client scripts (eBay, Amazon)

## Setup

### Prerequisites

- Node.js (with npm)

### Install

```bash
cd backend
npm install
```

### Configure API credentials

Create `backend/.env` (gitignored, never commit this file) with:

```
EBAY_ENV=
EBAY_APP_ID=
EBAY_DEV_ID=
EBAY_CERT_ID=

AMAZON_ACCESS_KEY=
AMAZON_SECRET_KEY=
AMAZON_PARTNER_TAG=
AMAZON_REGION=
AMAZON_HOST=
AMAZON_MARKETPLACE=
```

> Note: per the project brief, Amazon's PA-API is retired — the Amazon Creators API is the current path but is currently blocked pending Associates approval. Don't build against PA-API.

### Run

```bash
cd backend
npm run test:ebay [search query]      # e.g. npm run test:ebay "brake pads"
npm run test:amazon [search query]
```

Both default to `"brake pads"` if no query is given.
