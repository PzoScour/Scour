import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchItems } from './ebayClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 3000;

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
    url: item.itemWebUrl,
  };
}

const app = express();
app.use(express.static(SITE_ROOT));

app.get('/api/search', async (req, res) => {
  const { year = '', make = '', model = '', part = '', condition: conditionPref = 'any' } = req.query;

  if (!make || !model || !part) {
    return res.status(400).json({ error: 'make, model, and part are required' });
  }

  const query = [year, make, model, part].filter(Boolean).join(' ').trim();

  let ebayResponse;
  try {
    ebayResponse = await searchItems(query, { limit: 24 });
  } catch (err) {
    console.error('eBay search failed:', err);
    return res.status(502).json({ error: 'Live eBay search failed — try again in a moment.' });
  }

  let results = (ebayResponse.itemSummaries ?? []).map(mapItem);

  if (conditionPref === 'new') results = results.filter((r) => r.condition.startsWith('New'));
  if (conditionPref === 'oem') results = results.filter((r) => r.condition === 'New OEM');
  // 'used' and 'any' apply no additional filter — used/refurbished listings stay included

  res.json({ query, results });
});

app.listen(PORT, () => {
  console.log(`Scour dev server running at http://localhost:${PORT}`);
});
