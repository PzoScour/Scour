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
// NOTE: "module" is deliberately left out — on hybrid vehicles a "battery
// module" is a genuine, individually-replaceable segment of the pack (not an
// accessory), and we have no reliable way from title text alone to tell that
// apart from an unrelated "current sensor module". The one bad listing we saw
// in testing ("Battery A Block Module Sensor") is already caught by "sensor".
const PART_EXCLUSIONS = {
  battery: /\b(sensor|cable|harness|terminal|connector|bracket|mount(ing)?s?|hold[\s-]?down|holder)\b/i,
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

  let ebayResponse;
  try {
    ebayResponse = await searchItems(query, { limit: 24, categoryIds: CAR_PARTS_CATEGORY_ID });
  } catch (err) {
    console.error('eBay search failed:', err);
    return res.status(502).json({ error: 'Live eBay search failed — try again in a moment.' });
  }

  let results = (ebayResponse.itemSummaries ?? []).map(mapItem);

  results = results.filter((r) => !isExcludedForPart(part, r.title));

  if (conditionPref === 'new') results = results.filter((r) => r.condition.startsWith('New'));
  if (conditionPref === 'oem') results = results.filter((r) => r.condition === 'New OEM');
  // 'used' and 'any' apply no additional filter — used/refurbished listings stay included

  res.json({ query, results });
});

app.listen(PORT, () => {
  console.log(`Scour dev server running at http://localhost:${PORT}`);
});
