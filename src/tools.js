import { z } from 'zod';

// Bounded, charset-limited inputs: everything ends up in backend query strings and store requests.
const text = (max = 200) => z.string().trim().min(1).max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Use YYYY-MM-DD');

const store = z.enum(['both', 'google', 'apple']).default('both');
const country = z.string().regex(/^[A-Za-z]{2}$/u, 'Two-letter ISO country code').optional().describe('ISO country code, e.g. us');
const lang = z.string().regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?$/u, 'Language code, e.g. en or pt-BR').optional().describe('Language code, e.g. en');
const countryOrAll = z.string().regex(/^(?:[A-Za-z]{2}|all)$/iu, 'Two-letter ISO country code or "all"').optional();
const langOrAll = z.string().regex(/^(?:[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?|all)$/iu, 'Language code or "all"').optional();
const appIdRe = /^[A-Za-z0-9._]{1,255}$/u;
const appId = z.string().regex(appIdRe, 'Package name or numeric App Store id').describe('Google Play package (com.spotify.music) or App Store numeric id');
const appPlatform = z.enum(['google', 'apple']).optional().describe('Store appId belongs to (inferred from format if omitted)');
const appId2 = z.string().regex(appIdRe, 'Package name or numeric App Store id').optional().describe('Pin the listing on the other store');
const keyword = z.string().trim().min(2).max(100);

const reviewFilters = {
  appId, appPlatform, appId2,
  title: text().optional().describe('App title, used to find the counterpart listing'),
  developer: text().optional(),
  platform: z.enum(['google', 'apple', 'both']).optional(),
  country: countryOrAll.describe('ISO country, or "all" for every storefront'),
  lang: langOrAll.describe('Language code, or "all" for multi-language'),
  max: z.number().int().positive().max(5000).optional(),
  sort: z.string().regex(/^[a-z_]{1,32}$/iu).optional().describe('newest | rating | helpful …'),
  stars: z.string().regex(/^[1-5](?:\s*,\s*[1-5]){0,4}$/u, 'Comma-separated 1-5, e.g. "1,2"').optional().describe('e.g. "1,2"'),
  minRating: z.number().min(1).max(5).optional(),
  maxRating: z.number().min(1).max(5).optional(),
  keyword: text().optional(),
  allKeywords: text().optional().describe('All words must match'),
  anyKeyword: text().optional().describe('Any word matches'),
  dateFrom: date.optional().describe('YYYY-MM-DD'),
  dateTo: date.optional().describe('YYYY-MM-DD'),
  version: text(50).optional(),
  minLength: z.number().int().nonnegative().max(100_000).optional(),
  replyOnly: z.boolean().optional().describe('Only reviews with a developer reply'),
};

const ro = { readOnlyHint: true, openWorldHint: true };

// OwlASO flags: lite/track expect "1"; replyOnly expects "true".
const flag = (v) => (v ? '1' : undefined);

// Keeps per-group stats but caps the review rows so full data fits a model context.
export function capFullReviews(data, perGroup) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.groups)) return data;
  let omitted = 0;
  const groups = data.groups.map((g) => {
    if (!g || !Array.isArray(g.reviews)) return g;
    const reviews = g.reviews;
    omitted += Math.max(0, reviews.length - perGroup);
    return { ...g, reviews: reviews.slice(0, perGroup) };
  });
  return { ...data, groups, reviewsPerGroup: perGroup, reviewsOmitted: omitted };
}

// name → { description, schema, route, map? } ; map adapts tool args to API query params.
export const TOOLS = [
  {
    name: 'owlaso_health',
    description: 'Check the OwlASO backend: version and whether it serves mock data.',
    schema: {},
    route: '/api/health',
  },
  {
    name: 'search_apps',
    description: 'Search apps by name, package name or App Store id on Google Play and/or the App Store.',
    schema: { q: text(), platform: z.enum(['all', 'google', 'apple']).default('all'), country, lang, limit: z.number().int().positive().max(50).optional() },
    route: '/api/search',
  },
  {
    name: 'analyze_keyword',
    description: 'ASO keyword analysis for one country: popularity, difficulty, opportunity, ranking apps, similar keywords, competitor keywords. Set lite to skip competitor probes and history. track keeps a history snapshot on lite runs.',
    schema: { keyword, store, country, lang, limit: z.number().int().positive().max(50).optional(), lite: z.boolean().optional(), track: z.boolean().optional() },
    route: '/api/asosearch',
    map: ({ keyword, lite, track, ...rest }) => ({ q: keyword, lite: flag(lite), track: flag(track), ...rest }),
  },
  {
    name: 'keyword_history',
    description: 'Daily rank/score snapshots (up to 180 days) for a keyword × store × country × language.',
    schema: { keyword, store, country, lang },
    route: '/api/asosearch/history',
    map: ({ keyword, ...rest }) => ({ q: keyword, ...rest }),
  },
  {
    name: 'app_details',
    description: 'Store listing details for an app, with its counterpart on the other store when store=both.',
    schema: { appId, platform: z.enum(['google', 'apple']).optional(), appId2, store, country, lang },
    route: '/api/app-details',
  },
  {
    name: 'get_reviews',
    description: 'Fetch and filter reviews (Google Play and/or App Store). Output is truncated if huge; use filters/max.',
    schema: reviewFilters,
    route: '/api/reviews',
    map: ({ replyOnly, ...rest }) => ({ replyOnly: replyOnly ? 'true' : undefined, ...rest }),
  },
  {
    name: 'get_full_reviews',
    description: 'Read every reachable review across stores and languages (slow; hits many sources). Returns global/per-store stats, complaint/praise terms and per-group reviews (capped by reviewsPerGroup; 0 = stats only).',
    schema: {
      appId, appPlatform, appId2, title: reviewFilters.title, platform: reviewFilters.platform, country: reviewFilters.country,
      reviewsPerGroup: z.number().int().min(0).max(1000).default(25),
    },
    route: '/api/reviews.full',
    map: ({ reviewsPerGroup: _, ...rest }) => rest,
    post: (data, { reviewsPerGroup }) => capFullReviews(data, reviewsPerGroup),
  },
];

export function register(server, client, toResult, toError) {
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.schema, annotations: ro },
      async (args) => {
        try {
          const data = await client.get(t.route, t.map ? t.map(args) : args);
          return toResult(t.post ? t.post(data, args) : data);
        } catch (error) {
          return toError(error);
        }
      },
    );
  }
}
