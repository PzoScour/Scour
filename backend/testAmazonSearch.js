import 'dotenv/config';
import { searchItems } from './amazonClient.js';

const query = process.argv[2] || 'brake pads';

const results = await searchItems(query);

console.log(`Query: "${query}"`);
console.log(`Items returned: ${results.SearchResult?.Items?.length ?? 0}`);
console.log('---');

for (const item of results.SearchResult?.Items ?? []) {
  const listing = item.Offers?.Listings?.[0];
  console.log(`${item.ItemInfo?.Title?.DisplayValue}`);
  console.log(`  price: ${listing?.Price?.DisplayAmount ?? 'n/a'}`);
  console.log(`  condition: ${listing?.Condition?.Value ?? 'n/a'}`);
  console.log(`  url: ${item.DetailPageURL}`);
  console.log('');
}
