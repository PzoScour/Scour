// STALE: PA-API 5.0 was retired 2026-05-15. This targets a dead endpoint.
// Amazon's replacement is the Creators API — do not use this file until it's rebuilt against that.
import { createHash, createHmac } from 'node:crypto';

const SERVICE = 'ProductAdvertisingAPI';
const TARGET = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';
const URI = '/paapi5/searchitems';

function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function getSigningKey(secretKey, dateStamp, region) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

function signRequest({ host, region, accessKey, secretKey, payload }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host,
    'x-amz-date': amzDate,
    'x-amz-target': TARGET,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');

  const canonicalRequest = [
    'POST',
    URI,
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(secretKey, dateStamp, region);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...headers, Authorization: authorization };
}

export async function searchItems(keywords, { itemCount = 10 } = {}) {
  const host = process.env.AMAZON_HOST;
  const region = process.env.AMAZON_REGION;
  const accessKey = process.env.AMAZON_ACCESS_KEY;
  const secretKey = process.env.AMAZON_SECRET_KEY;
  const partnerTag = process.env.AMAZON_PARTNER_TAG;
  const marketplace = process.env.AMAZON_MARKETPLACE;

  const payload = JSON.stringify({
    Keywords: keywords,
    ItemCount: itemCount,
    PartnerTag: partnerTag,
    PartnerType: 'Associates',
    Marketplace: marketplace,
    Resources: [
      'ItemInfo.Title',
      'Offers.Listings.Price',
      'Offers.Listings.Condition',
      'ItemInfo.ByLineInfo',
    ],
  });

  const headers = signRequest({ host, region, accessKey, secretKey, payload });

  const res = await fetch(`https://${host}${URI}`, {
    method: 'POST',
    headers,
    body: payload,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Amazon PA-API request failed: ${res.status} ${text}`);
  }

  return JSON.parse(text);
}
