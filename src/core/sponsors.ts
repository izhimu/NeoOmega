// Sponsor link — single source of truth.
// GitHub Sponsors unsupported in mainland CN; afdian covers CN + overseas cards.
export const AFDIAN_URL = 'https://afdian.com/a/izhimu';


// Afdian plan order links (creator page hides ids behind JS; fetched via public API)
export const SPONSOR_PLANS = [
  { planId: 'b3438c56bcad11f1a47d5254001e7c00', price: 6 },
  { planId: 'bf5fcb9ebcad11f1859152540025c377', price: 30 },
  { planId: '1c53344ebcae11f1adcb52540025c377', price: 99 },
];
export const afdianOrderUrl = (planId: string) => `https://afdian.com/order/create?plan_id=${planId}`;
// Public sponsor wall data, committed to repo root daily by CI. Replace owner/repo after pushing.
export const SPONSORS_JSON_URL = 'https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/NeoOmega/main/sponsors.json';
