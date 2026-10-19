/** Store adapters of the price tracker (07 §9). Walmart is not tracked: it blocks scraping (decision T34). */
export const ADAPTERS = ['amazon_mx', 'costco_mx', 'sams_mx'] as const;

export type Adapter = (typeof ADAPTERS)[number];
