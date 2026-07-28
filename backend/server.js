import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchItems } from './ebayClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 3000;

// eBay category 6030 = "Car & Truck Parts & Accessories" (under eBay Motors).
// Restricting search to this category excludes unrelated listings that only
// match on keyword (e.g. a key fob battery when searching "battery") since
// they live in an entirely different category tree (Consumer Electronics, etc.)
const CAR_PARTS_CATEGORY_ID = '6030';

const CONDITION_WEIGHT = {
  'New OEM': 0.9,
  'New Aftermarket': 0.75,
  'Refurbished': 0.6,
  'Used': 0.45,
};

// eBay's condition field doesn't distinguish OEM vs. aftermarket — fall back to
// a title keyword check (a real signal from the listing, not a fabricated one).
function bucketCondition(ebayCondition, title) {
  const c = (ebayCondition || '').toLowerCase();
  if (c.includes('refurb')) return 'Refurbished';
  if (c.includes('new')) return /\boem\b/i.test(title || '') ? 'New OEM' : 'New Aftermarket';
  return 'Used';
}

// A listing whose title reads as a sub-component (sensor, cable, bracket, ...)
// rather than the complete part itself. Same category-6030 relevance, but
// "Cheapest"/"Best Value" shouldn't crown a $19 sensor over the $200 part it
// attaches to just because both match the search keyword.
const ACCESSORY_TITLE_PATTERN =
  /\b(sensor|cable|harness|terminal|bracket|mount(ing)?s?|tray|cover|connector|adapter|hold[\s-]?down|clip|pigtail|sleeve|module)\b/i;

function isAccessoryTitle(title) {
  return ACCESSORY_TITLE_PATTERN.test(title || '');
}

// Per-part-type hard exclusion: for a search this specific, "demote and still
// show" isn't good enough — a "Battery" search should return actual batteries,
// full stop. Keyed by the exact Part Needed value (case-insensitive). Add more
// parts here as they turn out to need the same treatment.
// NOTE: "module"/"assembly"/"assy" are deliberately left out — checked against
// a 10-make sweep (Honda, Toyota, Ford, Chevy, Nissan, Jeep, Subaru, BMW,
// Prius, Hyundai) and both words show up constantly on genuine complete
// batteries (hybrid packs are sold as "Battery Cell Module" or "Battery Pack
// Assembly"), not just accessories. Same for "hybrid", "vehicle", "voltage",
// "cell(s)", and brand/spec terms (AGM, Deka, ACDelco, Group ##) — all
// describe genuine batteries, not sub-components.
const PART_EXCLUSIONS = {
  // Includes "key fob"/"keyless" because category-6030 filtering isn't
  // airtight — a keyless-entry fob battery slipped through under it during
  // testing (Chevy Silverado), the exact failure mode category filtering was
  // meant to prevent. Also "emergency" — a BMW "330mah Emergency Battery" (an
  // eCall backup cell, not the car battery) showed up as the cheapest result
  // for that make during testing. "fuse\w*" (not "fuse(s)?") to also catch
  // compound listings like "Fuselink". Thermal-management accessories
  // (cooler/chiller/fan/shield/blower/warmer/blanket) and electrical-junction
  // accessories (distribution/junction/strap) both turned up repeatedly
  // across the 10-make sweep as separate parts, not just the battery itself.
  // "nut"/"bolt" added after a Subaru Outback search returned nothing but a
  // "Battery Nut" and "Battery Bolt" (hold-down hardware) even at a 100-item
  // fetch pool — see FALLBACK note below for what happens when exclusion
  // would otherwise leave zero results.
  // Deliberately NOT excluding "lead" — "Negative IBS Battery Lead" (a wire
  // lead) is a real miss, but "lead" is also standard wording in "lead-acid
  // battery" on genuine listings; excluding it would cost far more than it fixes.
  battery:
    /\b(sensors?|cables?|harness(es)?|terminals?|connectors?|brackets?|mount(ing)?s?|hold[\s-]?down|holders?|fuse\w*|trays?|covers?|relays?|chargers?|warmers?|blankets?|tie[\s-]?down|key\s*fob|keyless|emergency|coolers?|chillers?|fans?|shields?|blowers?|distribution|junction|straps?|pads?|nuts?|bolts?)\b/i,
  // "Aftermarket Seats" pulls in seat covers, mounting brackets/adapters, seat
  // belt pads, and power-seat switches that all share the keyword but aren't
  // a seat. Also excludes lug nuts, since "seat" is also the term for a lug
  // nut's conical mating surface (e.g. "Acorn Cone Seat") — a real keyword
  // collision with an unrelated product, not an accessory of the seat itself.
  // "buckle" added after a seat belt buckle listing won "Cheapest" in production.
  'aftermarket seats': /\b(cover(s)?|bracket(s)?|adapter(s)?|pad(s)?|switch(es)?|base(s)?|lug\s*nuts?|acorn|buckles?)\b/i,
  // "Sway Bars" pulls in end links (a separate, cheaper suspension part) far
  // more often than actual bars in real results. "bushing" added after
  // several sway bar bushing listings won "Cheapest" in production.
  'sway bars': /\b(links?|bushings?)\b/i,
};

function isExcludedForPart(part, title) {
  const pattern = PART_EXCLUSIONS[(part || '').trim().toLowerCase()];
  return pattern ? pattern.test(title || '') : false;
}

function shipDaysFromOptions(shippingOptions) {
  const maxDate = shippingOptions?.[0]?.maxEstimatedDeliveryDate;
  if (!maxDate) return 5;
  const days = Math.ceil((new Date(maxDate) - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

function mapItem(item) {
  const condition = bucketCondition(item.condition, item.title);
  // eBay has no per-item star rating; seller feedback is the closest real proxy.
  const feedbackPct = item.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : 80;
  const trust = feedbackPct / 100;
  const rating = Math.round((feedbackPct / 20) * 10) / 10;
  const reviews = item.seller?.feedbackScore ?? 0;
  const price = Number(item.price?.value ?? 0);
  const origPriceRaw = item.marketingPrice?.originalPrice?.value;
  const origPrice = origPriceRaw ? Number(origPriceRaw) : null;
  const condWeight = CONDITION_WEIGHT[condition] ?? 0.5;
  const reliability = Math.min(1, trust * 0.6 + (rating / 5) * 0.3 + condWeight * 0.1);

  return {
    retailer: 'eBay',
    tag: 'marketplace',
    title: item.title,
    condition,
    price,
    origPrice,
    rating,
    reviews,
    shipDays: shipDaysFromOptions(item.shippingOptions),
    reliability,
    isAccessory: isAccessoryTitle(item.title),
    url: item.itemWebUrl,
  };
}

const app = express();
app.use(express.static(SITE_ROOT, { extensions: ['html'] }));

app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/api/search', async (req, res) => {
  const { year = '', make = '', model = '', part = '', condition: conditionPref = 'any' } = req.query;

  if (!make || !model || !part) {
    return res.status(400).json({ error: 'make, model, and part are required' });
  }

  const query = [year, make, model, part].filter(Boolean).join(' ').trim();

  // Parts with a hard exclusion rule lose a large share of raw results (often
  // 80%+), so fetch a bigger pool for those — otherwise a run of accessory
  // listings at the top of eBay's relevance ranking can exclude everything
  // and return zero results even though genuine matches exist further down.
  const hasExclusionRule = Boolean(PART_EXCLUSIONS[(part || '').trim().toLowerCase()]);
  const fetchLimit = hasExclusionRule ? 50 : 24;

  let ebayResponse;
  try {
    ebayResponse = await searchItems(query, { limit: fetchLimit, categoryIds: CAR_PARTS_CATEGORY_ID });
  } catch (err) {
    console.error('eBay search failed:', err);
    return res.status(502).json({ error: 'Live eBay search failed — try again in a moment.' });
  }

  let results = (ebayResponse.itemSummaries ?? []).map(mapItem);

  // FALLBACK: if every raw result happens to be an accessory (seen on some
  // vehicles where eBay's relevance ranking is saturated with sensor/bracket
  // listings from a few high-volume sellers), hard-excluding everything would
  // show "no matches found" even though the part legitimately exists — worse
  // than showing unfiltered results. Only fall back to unfiltered when
  // filtering would otherwise zero out an otherwise non-empty result set.
  const excludedResults = results.filter((r) => !isExcludedForPart(part, r.title));
  if (excludedResults.length > 0 || results.length === 0) {
    results = excludedResults;
  }

  if (conditionPref === 'new') results = results.filter((r) => r.condition.startsWith('New'));
  if (conditionPref === 'oem') results = results.filter((r) => r.condition === 'New OEM');
  // 'used' and 'any' apply no additional filter — used/refurbished listings stay included

  res.json({ query, results });
});

app.listen(PORT, () => {
  console.log(`Scour dev server running at http://localhost:${PORT}`);
});
