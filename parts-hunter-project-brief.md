# Parts Hunter — Project Brief

**Status:** Pre-development / API access pending
**Last updated:** July 2026

---

## 1. What this is

Parts Hunter is a consumer web app that helps car owners find the cheapest reliable price for a specific auto part. A user enters their vehicle (year/make/model) and the part they need, and the app searches multiple retailers/marketplaces and returns ranked results by price, condition, and reliability — so the person doesn't have to manually check five different sites.

**One-line pitch:** "Enter your car and the part you need. We find every price so you don't have to."

## 2. Goals for the MVP (and explicit non-goals)

**In scope for MVP:**
- Search by year, make, model, part name
- Pull real listings from whichever APIs we get approved for (see Section 4)
- Normalize results into one comparison view
- Highlight "Cheapest" and "Best Value" picks
- Basic condition filter (new / used / any)
- Affiliate link-out to the retailer to complete purchase

**Explicitly out of scope for MVP** (revisit post-launch):
- User accounts / saved searches
- Price alerts or tracking over time
- In-app checkout (we route out to the retailer, we don't handle payment)
- VIN-level fitment precision (start with year/make/model; VIN decoding is a fast-follow)
- Mobile app (start web-only, responsive)
- Coverage of every part category — start narrow (see Section 8)

## 3. Target user

Someone who needs a specific replacement part (DIYer doing their own repair, or someone price-checking before a shop quote) and currently has to manually check 3-5 sites to feel confident they're not overpaying. Not targeting professional repair shops — that's PartsTech's existing customer base, not ours.

## 4. Data sources / APIs

| Source | Status | Notes |
|---|---|---|
| eBay Browse/Taxonomy API | Applying — self-serve, should be fast | Has real parts-compatibility search by year/make/model. Start here. |
| ~~Amazon Product Advertising API (PA-API 5.0)~~ | **Retired** — Amazon deprecated PA-API on 2026-05-15, replaced by the Creators API | Do not build against PA-API; any existing PA-API integration code is targeting a dead endpoint. |
| Amazon Creators API | Blocked — docs gated behind Associates Central login, and eligibility now requires 10 qualifying sales in the trailing 30 days (up from PA-API's 3 sales/180 days) | Must sign up for Associates and generate real qualifying sales before technical docs/credentials are even reachable. Secondary sources conflict on auth model (OAuth2 client-credentials vs. Login-with-Amazon-style credentials in body) — don't build against guessed specs. |
| PartsTech API | **Rejected** (2026-07-04) | No longer a viable data source. Was the only planned path to mainstream chain retailers — see replacement sources below. |
| CJ Affiliate → AutoZone | Not yet applied | Join CJ Affiliate as a publisher, then apply to AutoZone's program inside CJ. CJ offers a Product Feed API / GraphQL Product Search API for approved publishers — covers AutoZone product + pricing data. |
| Impact.com → Advance Auto Parts | Not yet applied | Join Impact.com as a partner, then apply to Advance Auto Parts' program. Impact's Product Ads Manager REST API (`ItemSearch`) covers retail catalogs including price. |
| Rakuten Advertising → NAPA | Not yet applied | Join Rakuten Advertising as a publisher, then apply to NAPA's program. Rakuten has its own product feed/search API for approved publishers — NAPA-specific feed availability unconfirmed until accepted. |
| NHTSA VIN Decoder API | Free, public, no approval needed | Use for validating/decoding year/make/model input, and later for VIN-based lookup. |

**No coverage path found for:** O'Reilly Auto Parts (no affiliate program on any major network) or RockAuto (no affiliate program at all).

**Do not scrape retailer websites directly** (e.g. RockAuto, AutoZone, O'Reilly) — violates their Terms of Service, breaks on redesign, and risks IP blocks. All data must come through the above sanctioned APIs.

## 5. Normalized data schema

Every source's response gets mapped into one internal shape before it reaches the frontend:

```json
{
  "retailer": "string",
  "source_api": "ebay | amazon | partstech",
  "part_name": "string",
  "condition": "New OEM | New Aftermarket | Refurbished | Used",
  "price": "number (USD)",
  "original_price": "number | null",
  "shipping_days": "number",
  "rating": "number | null",
  "review_count": "number | null",
  "url": "string (affiliate link)",
  "fitment_confidence": "exact | probable | unknown",
  "fetched_at": "timestamp"
}
```

## 6. Architecture overview

```
[Frontend: search form + results UI]
          |
          v
[Backend API endpoint: /search]
          |
   +------+------+------+
   |      |      |
[eBay]  [Amazon] [PartsTech]
   |      |      |
   +------+------+
          |
   [Normalize into schema above]
          |
   [Cache layer — Redis, TTL ~1-6hrs per query]
          |
   [Ranking logic: cheapest, best value score]
          |
          v
   [Return to frontend]
```

**Why caching matters:** we can't hit live retailer APIs on every single user search — both for cost (some APIs charge per call) and rate limits. Cache identical searches (same year/make/model/part) for a few hours.

**Ranking logic** (already prototyped, reuse as-is):
- `priceScore` = normalized position between cheapest and priciest result for that search
- `value` = `priceScore * 0.55 + reliability * 0.45`
- `reliability` = weighted blend of retailer trust, item rating, and condition

## 7. Suggested tech stack

- **Frontend:** React (matches the existing prototype's structure) or plain HTML/JS if keeping it simple for MVP
- **Backend:** Node.js — keeps frontend/backend in one language, simplest for a first build
- **Database/cache:** Redis for the search cache; Postgres if we add saved searches later (not MVP)
- **Hosting:** Vercel (frontend) + Railway or Render (backend/cache) — both have free tiers suitable for MVP traffic
- **Version control:** GitHub

## 8. Launch scope — start narrow

Don't launch with "every part for every car." Start with:
- **5-8 high-search-volume parts:** brake pads, batteries, alternators, headlight assemblies, spark plugs, air filters
- **5-10 popular vehicles:** Honda Civic, Toyota Camry, Ford F-150, Honda Accord, Chevrolet Silverado, Toyota Corolla

Expand coverage once real usage data shows what people are actually searching for.

## 9. Design reference

An HTML/CSS prototype already exists (`parts-hunter.html`) establishing the visual identity — reuse this styling rather than redesigning from scratch:

- **Concept:** styled like a mechanic's work order / parts ticket, not a generic search app
- **Palette:** graphite background (`#181B1F`), panel gray (`#21252B`), safety amber accent (`#FF9F1C`), blueprint blue secondary (`#5B8DEF`), green for "cheapest" (`#4CAF6D`)
- **Type:** Oswald (display/headers), Inter (body), IBM Plex Mono (prices, SKUs, technical labels)
- **Signature element:** a horizontal price-spread gauge showing where each retailer's price falls between cheapest and priciest, with the best-value pick marked
- **Cards:** styled like parts hangtags, with badges for "Cheapest" and "Best Value"

## 10. Error / empty states to handle

- No results for a given year/make/model/part combination → clear message, suggest broadening the search
- API partially fails (e.g. eBay responds, Amazon times out) → show what we have, don't block on every source
- Ambiguous vehicle input (e.g. model doesn't exist for that year) → validate against NHTSA data where possible

## 11. Monetization

Affiliate commission model — we route users to the retailer's site to complete purchase and earn a referral fee (eBay Partner Network, Amazon Associates, and PartsTech's own commercial terms if approved). This must be legally disclosed in-app.

## 12. Legal basics needed before public launch

- Affiliate relationship disclosure (required by FTC guidelines when earning commission on links)
- Terms of service
- Privacy policy (especially once/if any user data is stored)

## 13. Open questions / decisions pending

- [x] PartsTech reply — **rejected** (2026-07-04)
- [ ] CJ Affiliate publisher signup + AutoZone program approval
- [ ] Impact.com partner signup + Advance Auto Parts program approval
- [ ] Rakuten Advertising publisher signup + NAPA program approval, and confirm whether NAPA's feed is actually accessible once accepted
- [ ] Final call on frontend framework (React vs. plain HTML/JS for v1)
- [ ] Confirm Amazon Associates approval timeline once applied
- [ ] Domain name decision

---

*This brief is meant to be handed to Claude Code as the starting spec for development. Attach `parts-hunter.html` alongside it as the visual/interaction reference.*
