/** ISO 3166-1 alpha-2 codes for the markets a study is likely to name, for the persona grid headers. */
const ISO: Record<string, string> = {
  argentina: 'AR', australia: 'AU', austria: 'AT', bangladesh: 'BD', belgium: 'BE', brazil: 'BR', canada: 'CA', chile: 'CL',
  china: 'CN', 'mainland china': 'CN', colombia: 'CO', 'czech republic': 'CZ', czechia: 'CZ', denmark: 'DK', egypt: 'EG',
  finland: 'FI', france: 'FR', germany: 'DE', greece: 'GR', 'hong kong': 'HK', 'hong kong sar': 'HK', hungary: 'HU', india: 'IN',
  indonesia: 'ID', ireland: 'IE', israel: 'IL', italy: 'IT', japan: 'JP', kenya: 'KE', korea: 'KR', 'south korea': 'KR',
  kuwait: 'KW', malaysia: 'MY', mexico: 'MX', morocco: 'MA', netherlands: 'NL', 'new zealand': 'NZ', nigeria: 'NG', norway: 'NO',
  pakistan: 'PK', peru: 'PE', philippines: 'PH', poland: 'PL', portugal: 'PT', qatar: 'QA', romania: 'RO', russia: 'RU',
  'saudi arabia': 'SA', ksa: 'SA', singapore: 'SG', 'south africa': 'ZA', spain: 'ES', sweden: 'SE', switzerland: 'CH', taiwan: 'TW',
  thailand: 'TH', turkey: 'TR', türkiye: 'TR', uae: 'AE', 'united arab emirates': 'AE', uk: 'GB', 'united kingdom': 'GB', 'great britain': 'GB',
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US', vietnam: 'VN', 'viet nam': 'VN',
};

export function isoCode(market: string): string | null {
  return ISO[market.trim().toLowerCase()] ?? null;
}
