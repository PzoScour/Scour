const EBAY_HOST = process.env.EBAY_ENV === 'production' ? 'api.ebay.com' : 'api.sandbox.ebay.com';

let cachedToken = null;
let cachedTokenExpiry = 0;

export async function getAppToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) {
    return cachedToken;
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`
  ).toString('base64');

  const res = await fetch(`https://${EBAY_HOST}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!res.ok) {
    throw new Error(`eBay token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export async function searchItems(query, { limit = 10 } = {}) {
  const token = await getAppToken();

  const url = new URL(`https://${EBAY_HOST}/buy/browse/v1/item_summary/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!res.ok) {
    throw new Error(`eBay search request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
