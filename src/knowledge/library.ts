/**
 * Curated knowledge bases used by the Results step (planner context and the Knowledge library).
 *
 *   COMMS_SKILLS  recognised public relations, communications and marketing frameworks and methods.
 *   MARKET_ENTRY  how foreign brands enter a new market, across industries: strategy frameworks,
 *                 entry modes, and the public data sources teams use to assess a market.
 *
 * Every entry is a short summary written for this app, in its own words, with the publisher and a
 * link to the original. Sources are restricted to professional bodies, governments, multilateral
 * institutions, peer-reviewed journals and the framework's originator. Add or correct entries here;
 * the planner and the library read this file and nothing else.
 */

export type KnowledgeBase = 'COMMS_SKILLS' | 'MARKET_ENTRY';

export const INDUSTRIES = [
  'All industries',
  'Consumer goods',
  'Food & beverage',
  'Beauty & personal care',
  'Technology & electronics',
  'Automotive & mobility',
  'Retail & e-commerce',
  'Financial services',
  'Healthcare & wellness',
  'Travel & hospitality',
  'B2B & industrial',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export interface KnowledgeEntry {
  id: string;
  base: KnowledgeBase;
  title: string;
  kind: 'framework' | 'method' | 'measurement' | 'regulation' | 'data source' | 'research';
  summary: string;
  whenToUse: string;
  steps: string[];
  industries: Industry[];
  tags: string[];
  source: { publisher: string; title: string; url: string; year?: number };
}

const ALL: Industry[] = ['All industries'];

export const KNOWLEDGE: KnowledgeEntry[] = [
  // ── PR, communications and marketing ─────────────────────────────────────
  {
    id: 'oasis',
    base: 'COMMS_SKILLS',
    title: 'OASIS campaign planning',
    kind: 'framework',
    summary: 'The UK Government Communication Service planning model: Objectives, Audience insight, Strategy and ideas, Implementation, Scoring and evaluation. It forces a campaign to start from a measurable objective and real audience insight before any tactic is chosen.',
    whenToUse: 'Structuring any campaign or communications plan from objective to evaluation.',
    steps: ['Set SMART communication objectives tied to the business objective', 'Build audience insight from data (who, what they think, where they are)', 'Choose the strategy and creative idea, with channels', 'Plan implementation: phasing, budget, owners', 'Define how success is scored before launch'],
    industries: ALL,
    tags: ['planning', 'objectives', 'evaluation'],
    source: { publisher: 'UK Government Communication Service', title: 'Guide to campaign planning: OASIS', url: 'https://www.communications.gov.uk/guidance/marketing/delivering-government-campaigns/guide-to-campaign-planning-oasis/' },
  },
  {
    id: 'peso',
    base: 'COMMS_SKILLS',
    title: 'PESO model (paid, earned, shared, owned)',
    kind: 'framework',
    summary: 'Integrates the four media types — paid advertising, earned media and PR, shared social, and owned content — so that each reinforces the others, with owned content and earned credibility at the centre.',
    whenToUse: 'Choosing and balancing channels for a launch or always-on programme.',
    steps: ['Start from owned content that carries the core story', 'Earn credibility through media, experts and reviews', 'Seed and amplify through shared social and creators', 'Use paid to reach and retarget the audiences that matter', 'Measure each type against the same objectives'],
    industries: ALL,
    tags: ['channels', 'integrated', 'media'],
    source: { publisher: 'Spin Sucks (Gini Dietrich, originator)', title: 'The PESO Model', url: 'https://spinsucks.com/communication/peso-model-breakdown/' },
  },
  {
    id: 'barcelona',
    base: 'COMMS_SKILLS',
    title: 'Barcelona Principles 3.0',
    kind: 'measurement',
    summary: 'The industry standard for communications measurement: set goals first, measure outcomes and impact rather than outputs, include qualitative as well as quantitative evidence, do not use advertising value equivalents, and measure ethically and transparently.',
    whenToUse: 'Defining KPIs and evaluation for PR and communications.',
    steps: ['Set measurable goals before activity', 'Measure outputs, outcomes and organisational impact', 'Include quality and context, not only volume', 'Never use AVEs', 'Measure across all channels, consistently and ethically'],
    industries: ALL,
    tags: ['measurement', 'kpi', 'evaluation'],
    source: { publisher: 'AMEC (International Association for the Measurement and Evaluation of Communication)', title: 'Barcelona Principles 3.0', url: 'https://amecorg.com/barcelona-principles-3-0/', year: 2020 },
  },
  {
    id: 'amec-ief',
    base: 'COMMS_SKILLS',
    title: 'AMEC Integrated Evaluation Framework',
    kind: 'measurement',
    summary: 'A step-by-step evaluation model linking objectives to inputs, activities, outputs, out-takes, outcomes and organisational impact.',
    whenToUse: 'Building the measurement plan and dashboard for a campaign.',
    steps: ['Align objectives with organisational goals', 'Record inputs and activities', 'Track outputs (what was produced and reached)', 'Measure out-takes (attention, understanding)', 'Measure outcomes (attitude, behaviour) and impact'],
    industries: ALL,
    tags: ['measurement', 'kpi'],
    source: { publisher: 'AMEC', title: 'Integrated Evaluation Framework', url: 'https://amecorg.com/amecframework/' },
  },
  {
    id: 'sostac',
    base: 'COMMS_SKILLS',
    title: 'SOSTAC marketing planning',
    kind: 'framework',
    summary: 'Situation, Objectives, Strategy, Tactics, Action, Control — a widely taught marketing planning sequence.',
    whenToUse: 'Writing a full marketing plan for a market or product.',
    steps: ['Situation analysis (where are we now)', 'Objectives (where do we want to be)', 'Strategy (how do we get there)', 'Tactics (the marketing mix and channels)', 'Action (who does what, when)', 'Control (how we monitor and adjust)'],
    industries: ALL,
    tags: ['planning', 'marketing'],
    source: { publisher: 'PR Smith (originator)', title: 'SOSTAC planning', url: 'https://prsmith.org/sostac/' },
  },
  {
    id: 'race',
    base: 'COMMS_SKILLS',
    title: 'RACE digital marketing framework',
    kind: 'framework',
    summary: 'Plan, Reach, Act, Convert, Engage — maps digital activity and KPIs to each stage of the customer lifecycle.',
    whenToUse: 'Planning the digital and e-commerce side of a market entry.',
    steps: ['Plan: goals, insight, budget', 'Reach: awareness through search, social, media', 'Act: interaction and leads on owned channels', 'Convert: sales online and offline', 'Engage: loyalty and advocacy'],
    industries: ['Consumer goods', 'Retail & e-commerce', 'Technology & electronics', 'Beauty & personal care', 'Food & beverage'],
    tags: ['digital', 'funnel', 'kpi'],
    source: { publisher: 'Smart Insights (Dave Chaffey)', title: 'RACE planning framework', url: 'https://www.smartinsights.com/digital-marketing-strategy/race-a-practical-framework-to-improve-your-digital-marketing/' },
  },
  {
    id: 'long-short',
    base: 'COMMS_SKILLS',
    title: 'Balancing brand building and activation (Binet & Field)',
    kind: 'research',
    summary: 'IPA effectiveness research finding that long-term brand building and short-term sales activation work differently, and that most budgets should be weighted towards brand building (roughly 60:40 as a starting point) for sustained growth.',
    whenToUse: 'Splitting a launch budget between awareness/brand and conversion.',
    steps: ['Fund broad-reach, emotional brand building for long-term growth', 'Fund targeted activation for short-term sales', 'Start near 60:40 brand to activation and adjust by category and stage', 'Judge brand work over months, not weeks'],
    industries: ALL,
    tags: ['budget', 'effectiveness', 'brand'],
    source: { publisher: 'IPA (Institute of Practitioners in Advertising)', title: 'The Long and the Short of It', url: 'https://ipa.co.uk/knowledge/publications-reports/the-long-and-the-short-of-it-balancing-short-and-long-term-marketing-strategies', year: 2013 },
  },
  {
    id: 'how-brands-grow',
    base: 'COMMS_SKILLS',
    title: 'Mental and physical availability (How Brands Grow)',
    kind: 'research',
    summary: 'Ehrenberg-Bass Institute evidence that brands grow mainly by reaching more category buyers, by being easy to think of in buying situations (mental availability) and easy to buy (physical availability), using consistent distinctive brand assets.',
    whenToUse: 'Setting reach, distribution and brand-asset priorities for a new entrant.',
    steps: ['Reach all category buyers, not only a niche', 'Build memory links to the buying situations that matter', 'Use distinctive assets consistently (colour, logo, characters)', 'Make the product easy to find and buy in each channel'],
    industries: ['Consumer goods', 'Food & beverage', 'Beauty & personal care', 'Retail & e-commerce'],
    tags: ['brand', 'growth', 'distribution'],
    source: { publisher: 'Ehrenberg-Bass Institute for Marketing Science', title: 'How Brands Grow', url: 'https://marketingscience.info/' },
  },
  {
    id: 'trust',
    base: 'COMMS_SKILLS',
    title: 'Building trust: competence and ethics',
    kind: 'research',
    summary: 'The Edelman Trust Barometer tracks trust in business, government, media and NGOs by country each year; it consistently finds trust rests on both competence and ethical conduct, and that foreign companies headquartered in some countries face a trust deficit.',
    whenToUse: 'Planning how a foreign (for example Chinese) brand earns trust in a new market.',
    steps: ['Check the market’s trust level in business and in companies from the home country', 'Prove competence: quality, certifications, local performance', 'Prove ethics: transparency, data practices, local commitment', 'Use credible local voices — experts, partners, employees'],
    industries: ALL,
    tags: ['trust', 'reputation', 'country of origin'],
    source: { publisher: 'Edelman', title: 'Edelman Trust Barometer', url: 'https://www.edelman.com/trust/trust-barometer' },
  },
  {
    id: 'scct',
    base: 'COMMS_SKILLS',
    title: 'Situational Crisis Communication Theory',
    kind: 'framework',
    summary: 'W. Timothy Coombs’ evidence-based model: match the crisis response to how much responsibility stakeholders attribute to the organisation, starting with instructing and adjusting information, then rebuilding, diminishing or denying as appropriate.',
    whenToUse: 'Preparing issues and crisis protocols before entering a market.',
    steps: ['Give instructing information first (what to do to be safe)', 'Express concern and explain corrective action', 'Assess attributed responsibility (victim, accidental, preventable)', 'Choose rebuild strategies for preventable crises', 'Factor in crisis history and prior reputation'],
    industries: ALL,
    tags: ['crisis', 'issues', 'reputation'],
    source: { publisher: 'Corporate Reputation Review (Coombs)', title: 'Protecting Organization Reputations During a Crisis', url: 'https://doi.org/10.1057/palgrave.crr.1550049', year: 2007 },
  },
  {
    id: 'influencer-disclosure',
    base: 'COMMS_SKILLS',
    title: 'Influencer and endorsement disclosure',
    kind: 'regulation',
    summary: 'Regulators require paid or gifted endorsements to be clearly disclosed. The US FTC Endorsement Guides are a widely used reference; most markets have their own advertising codes (for example the UK CAP Code) that creator programmes must follow.',
    whenToUse: 'Designing creator and influencer programmes in a new market.',
    steps: ['Check the market’s advertising code and regulator', 'Require clear, upfront disclosure of material connections', 'Brief creators in writing on claims they may and may not make', 'Monitor and keep records'],
    industries: ALL,
    tags: ['influencer', 'compliance', 'social'],
    source: { publisher: 'US Federal Trade Commission', title: 'Endorsements, Influencers, and Reviews', url: 'https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews' },
  },
  {
    id: 'hofstede',
    base: 'COMMS_SKILLS',
    title: 'Cultural dimensions for localisation',
    kind: 'research',
    summary: 'Hofstede’s country comparison scores national cultures on dimensions such as individualism, power distance and uncertainty avoidance — a starting point for adapting tone, proof points and spokespeople.',
    whenToUse: 'Adapting messages and creative between markets.',
    steps: ['Compare the home and target markets', 'Adjust tone (direct or indirect, individual or group benefits)', 'Choose proof points that fit uncertainty avoidance (guarantees, certifications)', 'Choose spokespeople that fit power distance'],
    industries: ALL,
    tags: ['culture', 'localisation', 'messaging'],
    source: { publisher: 'The Culture Factor Group (Hofstede Insights)', title: 'Country comparison tool', url: 'https://www.hofstede-insights.com/country-comparison-tool' },
  },
  {
    id: 'message-house',
    base: 'COMMS_SKILLS',
    title: 'Message house',
    kind: 'method',
    summary: 'A one-page structure for consistent messaging: an umbrella message (roof), three supporting pillars, and proof points for each (foundation).',
    whenToUse: 'Aligning spokespeople, agencies and markets on what to say.',
    steps: ['Write the umbrella message in one sentence', 'Choose three pillars the audience cares about', 'Back each pillar with evidence and stories', 'Adapt proof points per market, keep the roof constant'],
    industries: ALL,
    tags: ['messaging', 'spokespeople'],
    source: { publisher: 'CIPR (Chartered Institute of Public Relations)', title: 'Professional development resources', url: 'https://cipr.co.uk/' },
  },
  {
    id: 'stakeholder-map',
    base: 'COMMS_SKILLS',
    title: 'Stakeholder power–interest mapping',
    kind: 'method',
    summary: 'Mendelow’s matrix places stakeholders by power and interest to decide whom to manage closely, keep satisfied, keep informed or monitor.',
    whenToUse: 'Planning government, trade, media and community relations on entry.',
    steps: ['List stakeholders: regulators, partners, media, NGOs, communities', 'Score power and interest', 'Manage closely those high on both', 'Plan the cadence and owner for each group'],
    industries: ALL,
    tags: ['stakeholders', 'public affairs'],
    source: { publisher: 'Mendelow, Proceedings of the International Conference on Information Systems', title: 'Environmental scanning: the impact of the stakeholder concept', url: 'https://aisel.aisnet.org/icis1981/', year: 1981 },
  },

  // ── Market entry ─────────────────────────────────────────────────────────
  {
    id: 'cage',
    base: 'MARKET_ENTRY',
    title: 'CAGE distance framework',
    kind: 'framework',
    summary: 'Pankaj Ghemawat’s test of how far a target market really is from home: Cultural, Administrative/political, Geographic and Economic distance. Distance, not just market size, predicts how hard entry will be.',
    whenToUse: 'Comparing and prioritising candidate markets.',
    steps: ['Score cultural distance (language, norms, religion)', 'Score administrative distance (trade ties, political relations, regulation)', 'Score geographic distance (logistics, time zones)', 'Score economic distance (income, costs, infrastructure)', 'Weigh distance against market size'],
    industries: ALL,
    tags: ['market selection', 'prioritisation'],
    source: { publisher: 'Harvard Business Review', title: 'Distance Still Matters', url: 'https://hbr.org/2001/09/distance-still-matters-the-hard-reality-of-global-expansion', year: 2001 },
  },
  {
    id: 'uppsala',
    base: 'MARKET_ENTRY',
    title: 'Uppsala internationalisation model',
    kind: 'research',
    summary: 'Firms internationalise step by step, committing more as they learn and build relationships in a market; liability of outsidership (lacking local networks) is a bigger barrier than foreignness itself.',
    whenToUse: 'Phasing commitment: test, learn, then scale.',
    steps: ['Start in markets with lower psychic distance', 'Enter with lower-commitment modes and learn', 'Build insider relationships with partners and networks', 'Increase commitment as knowledge grows'],
    industries: ALL,
    tags: ['phasing', 'entry mode'],
    source: { publisher: 'Journal of International Business Studies (Johanson & Vahlne)', title: 'The Uppsala internationalization process model revisited', url: 'https://doi.org/10.1057/jibs.2009.24', year: 2009 },
  },
  {
    id: 'entry-modes',
    base: 'MARKET_ENTRY',
    title: 'Entry modes and the OLI paradigm',
    kind: 'framework',
    summary: 'Dunning’s eclectic (OLI) paradigm explains the choice of entry mode — exporting, licensing or franchising, joint venture, or wholly owned subsidiary — by Ownership advantages, Location advantages and Internalisation benefits. More control means more cost and risk.',
    whenToUse: 'Choosing how to enter: marketplace, distributor, partner, JV or own subsidiary.',
    steps: ['Identify what is unique to the brand (ownership advantage)', 'Identify what the market offers (location advantage)', 'Decide what must be kept in-house (internalisation)', 'Match to a mode: cross-border e-commerce, distributor, licence/franchise, JV, subsidiary'],
    industries: ALL,
    tags: ['entry mode', 'partnerships'],
    source: { publisher: 'Journal of International Business Studies (Dunning)', title: 'The Eclectic Paradigm of International Production', url: 'https://doi.org/10.1057/palgrave.jibs.8490372', year: 1988 },
  },
  {
    id: 'five-forces',
    base: 'MARKET_ENTRY',
    title: 'Five competitive forces',
    kind: 'framework',
    summary: 'Michael Porter’s analysis of industry attractiveness: rivalry, threat of new entrants, buyer power, supplier power and threat of substitutes.',
    whenToUse: 'Assessing how profitable a category will be in the new market.',
    steps: ['Map existing rivals and their positions', 'Assess barriers protecting incumbents', 'Assess the power of retailers, platforms and buyers', 'Assess supplier power and substitutes', 'Decide where the brand can defend a position'],
    industries: ALL,
    tags: ['competition', 'category'],
    source: { publisher: 'Harvard Business Review', title: 'The Five Competitive Forces That Shape Strategy', url: 'https://hbr.org/2008/01/the-five-competitive-forces-that-shape-strategy', year: 2008 },
  },
  {
    id: 'pestle',
    base: 'MARKET_ENTRY',
    title: 'PESTLE analysis',
    kind: 'method',
    summary: 'A scan of Political, Economic, Social, Technological, Legal and Environmental factors in the target market.',
    whenToUse: 'The macro-environment section of a market-entry assessment.',
    steps: ['List factors under each heading', 'Rate impact and likelihood', 'Separate trends from one-off events', 'Feed the top risks into the entry plan'],
    industries: ALL,
    tags: ['macro', 'risk'],
    source: { publisher: 'CIPD', title: 'PESTLE analysis factsheet', url: 'https://www.cipd.org/uk/knowledge/factsheets/pestle-analysis-factsheet/' },
  },
  {
    id: 'country-of-origin',
    base: 'MARKET_ENTRY',
    title: 'Country-of-origin effects and global attitudes',
    kind: 'research',
    summary: 'Consumers judge products partly by where they come from; attitudes to the home country carry over to its brands. Pew Research Center’s global attitudes surveys track views of China and other countries by market — useful for the brand-friendliness pillar.',
    whenToUse: 'Assessing how a Chinese (or any foreign) brand will be received.',
    steps: ['Check favourability towards the home country in each market', 'Decide whether to lead with or play down origin', 'Lead with product proof where origin is a barrier', 'Track sentiment over time'],
    industries: ALL,
    tags: ['brand friendliness', 'country of origin', 'china'],
    source: { publisher: 'Pew Research Center', title: 'Global attitudes: views of China', url: 'https://www.pewresearch.org/topic/international-affairs/global-image-of-countries/china/' },
  },
  {
    id: 'b-ready',
    base: 'MARKET_ENTRY',
    title: 'Business environment benchmarks (B-READY)',
    kind: 'data source',
    summary: 'The World Bank’s Business Ready report, successor to Doing Business, benchmarks regulation, public services and operational efficiency for setting up and running a firm, by economy.',
    whenToUse: 'Comparing how easy it is to establish and operate in each market.',
    steps: ['Check business entry, operating location and utilities', 'Check labour, financial services and international trade', 'Check taxation, dispute resolution and competition', 'Note topics where the market scores low'],
    industries: ALL,
    tags: ['regulation', 'operations', 'data'],
    source: { publisher: 'World Bank', title: 'Business Ready (B-READY)', url: 'https://www.worldbank.org/en/businessready' },
  },
  {
    id: 'fdi-index',
    base: 'MARKET_ENTRY',
    title: 'FDI Regulatory Restrictiveness Index',
    kind: 'data source',
    summary: 'The OECD index scores statutory restrictions on foreign direct investment — equity limits, screening, key-personnel rules and operational restrictions — by country and sector, from 0 (open) to 1 (closed).',
    whenToUse: 'Checking whether a sector limits foreign ownership before choosing an entry mode.',
    steps: ['Look up the target market and sector', 'Check equity caps and screening/approval rules', 'Choose a mode that fits the limits (for example a JV where ownership is capped)'],
    industries: ALL,
    tags: ['regulation', 'ownership', 'data'],
    source: { publisher: 'OECD', title: 'FDI Regulatory Restrictiveness Index', url: 'https://www.oecd.org/en/topics/sub-issues/sustainable-investment/fdi-regulatory-restrictiveness-index.html' },
  },
  {
    id: 'trade-data',
    base: 'MARKET_ENTRY',
    title: 'Trade flows and market access (ITC)',
    kind: 'data source',
    summary: 'The International Trade Centre’s Trade Map shows import demand by product and country; Market Access Map shows tariffs, trade agreements and non-tariff measures that apply to a product.',
    whenToUse: 'Sizing import demand and checking tariffs and preferences for a product.',
    steps: ['Find the product’s HS code', 'Check import values and growth in each market', 'Check applied tariffs and any preferential agreement', 'Check non-tariff measures and rules of origin'],
    industries: ['Consumer goods', 'Food & beverage', 'Beauty & personal care', 'Technology & electronics', 'Automotive & mobility', 'B2B & industrial'],
    tags: ['tariffs', 'trade', 'data'],
    source: { publisher: 'International Trade Centre (UN/WTO)', title: 'Trade Map and Market Access Map', url: 'https://www.trademap.org/' },
  },
  {
    id: 'standards',
    base: 'MARKET_ENTRY',
    title: 'Product standards and technical regulations',
    kind: 'regulation',
    summary: 'Most markets require product certification (safety, electrical, radio, food, cosmetics). WTO members notify new technical regulations, which can be tracked through the ePing alert service.',
    whenToUse: 'Planning certification lead times for physical products.',
    steps: ['Identify the regulator and standard for the product in each market', 'Plan testing and certification lead times', 'Subscribe to notifications for the product', 'Budget for labelling in the local language'],
    industries: ['Consumer goods', 'Food & beverage', 'Beauty & personal care', 'Technology & electronics', 'Automotive & mobility', 'Healthcare & wellness'],
    tags: ['certification', 'compliance'],
    source: { publisher: 'WTO / UN DESA / ITC', title: 'ePing SPS & TBT notification alert system', url: 'https://www.epingalert.org/' },
  },
  {
    id: 'trademarks',
    base: 'MARKET_ENTRY',
    title: 'Protect the brand first: international trademarks',
    kind: 'regulation',
    summary: 'Register trademarks in each target market before announcing entry. WIPO’s Madrid System files one application for many member countries.',
    whenToUse: 'Before any public launch activity.',
    steps: ['Search for conflicting marks in each market', 'File through the Madrid System or nationally', 'Register local-language and transliterated names', 'Monitor and enforce against squatters and counterfeits'],
    industries: ALL,
    tags: ['ip', 'brand protection'],
    source: { publisher: 'WIPO', title: 'Madrid System', url: 'https://www.wipo.int/madrid/en/' },
  },
  {
    id: 'privacy',
    base: 'MARKET_ENTRY',
    title: 'Data protection and privacy laws',
    kind: 'regulation',
    summary: 'Most markets now have comprehensive data protection laws (for example the EU GDPR, Singapore PDPA, Indonesia PDP Law) that govern consumer data, marketing consent and cross-border transfers.',
    whenToUse: 'Any market entry that collects consumer data — e-commerce, apps, CRM, connected devices.',
    steps: ['Identify the law and regulator in each market', 'Set lawful bases and consent for marketing', 'Check rules on cross-border data transfer', 'Appoint local representatives where required'],
    industries: ['Technology & electronics', 'Retail & e-commerce', 'Financial services', 'Healthcare & wellness', 'Automotive & mobility', 'Consumer goods'],
    tags: ['privacy', 'compliance', 'data'],
    source: { publisher: 'IAPP', title: 'Global privacy law and DPA directory', url: 'https://iapp.org/resources/global-privacy-directory/' },
  },
  {
    id: 'integrity',
    base: 'MARKET_ENTRY',
    title: 'Corruption risk and integrity',
    kind: 'data source',
    summary: 'Transparency International’s Corruption Perceptions Index ranks countries by perceived public-sector corruption; anti-bribery laws such as the US FCPA and UK Bribery Act can apply to conduct abroad.',
    whenToUse: 'Due diligence on partners, distributors and government relations.',
    steps: ['Check the market’s CPI score', 'Run due diligence on partners and agents', 'Set gifts, hospitality and third-party rules', 'Train local staff'],
    industries: ALL,
    tags: ['compliance', 'risk'],
    source: { publisher: 'Transparency International', title: 'Corruption Perceptions Index', url: 'https://www.transparency.org/en/cpi' },
  },
  {
    id: 'investment-trends',
    base: 'MARKET_ENTRY',
    title: 'Global investment trends',
    kind: 'data source',
    summary: 'UNCTAD’s annual World Investment Report tracks foreign direct investment flows, investment policy changes and sector trends by region.',
    whenToUse: 'Context on investment climate and policy direction in a region.',
    steps: ['Read the regional chapter for the target markets', 'Note new investment incentives or restrictions', 'Check sector trends relevant to the brand'],
    industries: ALL,
    tags: ['investment', 'policy', 'data'],
    source: { publisher: 'UNCTAD', title: 'World Investment Report', url: 'https://unctad.org/topic/investment/world-investment-report' },
  },
  {
    id: 'digital-landscape',
    base: 'MARKET_ENTRY',
    title: 'Digital and social landscape by country',
    kind: 'data source',
    summary: 'DataReportal’s annual Digital reports (with We Are Social and Meltwater) give internet, social platform and e-commerce adoption by country — the basis for the digital-readiness pillar and channel choice.',
    whenToUse: 'Choosing platforms and judging digital readiness.',
    steps: ['Check internet and mobile adoption', 'Check which social platforms lead', 'Check e-commerce adoption and payment habits', 'Plan channels to match'],
    industries: ALL,
    tags: ['digital readiness', 'channels', 'data'],
    source: { publisher: 'DataReportal', title: 'Digital reports by country', url: 'https://datareportal.com/' },
  },
  {
    id: 'halal',
    base: 'MARKET_ENTRY',
    title: 'Halal certification in Muslim-majority markets',
    kind: 'regulation',
    summary: 'Food, beverage, cosmetics and some pharmaceutical products may require or benefit from halal certification. Indonesia’s halal product law makes certification mandatory for many categories, administered by BPJPH; Malaysia’s standard is run by JAKIM.',
    whenToUse: 'Entering Indonesia, Malaysia, the Gulf and other Muslim-majority markets with consumables.',
    steps: ['Check whether certification is mandatory for the category', 'Choose a certifier recognised in the target market', 'Audit ingredients and supply chain', 'Show the mark on pack and in communications'],
    industries: ['Food & beverage', 'Beauty & personal care', 'Healthcare & wellness'],
    tags: ['certification', 'religion', 'compliance'],
    source: { publisher: 'BPJPH (Indonesia Halal Product Assurance Agency)', title: 'Halal certification', url: 'https://bpjph.halal.go.id/' },
  },
];

export function knowledge(base?: KnowledgeBase, industry?: string): KnowledgeEntry[] {
  return KNOWLEDGE.filter((k) => (!base || k.base === base) && (!industry || industry === 'All industries' || k.industries.includes('All industries') || k.industries.includes(industry as Industry)));
}

/** The entries as numbered context for a model prompt (K1, K2…), and the ids they map to. */
export function knowledgeContext(entries: KnowledgeEntry[]): { text: string; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const text = entries
    .map((k, i) => {
      const ref = `K${i + 1}`;
      ids.set(ref, k.id);
      return `${ref} — ${k.title} (${k.source.publisher}): ${k.summary} Steps: ${k.steps.join('; ')}.`;
    })
    .join('\n');
  return { text, ids };
}
