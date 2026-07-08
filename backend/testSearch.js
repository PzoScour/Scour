import 'dotenv/config';
import { searchItems } from './ebayClient.js';

const query = process.argv[2] || 'brake pads';

const results = await searchItems(query);

console.log(`Query: "${query}"`);
console.log(`Total matches reported by eBay: ${results.total ?? 0}`);
console.log(`Items returned: ${results.itemSummaries?.length ?? 0}`);
console.log('---');

for (const item of results.itemSummaries ?? []) {
  console.log(`${item.title}`);
  console.log(`  price: ${item.price?.value} ${item.price?.currency}`);
  console.log(`  condition: ${item.condition ?? 'n/a'}`);
  console.log(`  url: ${item.itemWebUrl}`);
  console.log('');
}
