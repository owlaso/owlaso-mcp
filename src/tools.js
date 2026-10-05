import { z } from 'zod';

const store = z.enum(['both', 'google', 'apple']).default('both');
const country = z.string().min(2).max(3).optional().describe('ISO country code, e.g. us');
const lang = z.string().optional().describe('Language code, e.g. en');
const appId = z.string().min(1).describe('Google Play package (com.spotify.music) or App Store numeric id');
const appPlatform = z.enum(['google', 'apple']).optional().describe('Store appId belongs to (inferred from format if omitted)');
const appId2 = z.string().optional().describe('Pin the listing on the other store');

const reviewFilters = {
  appId, appPlatform, appId2,
  title: z.string().optional().describe('App title, used to find the counterpart listing'),
  developer: z.string().optional(),
  platform: z.enum(['google', 'apple', 'both']).optional(),
  country: z.string().optional().describe('ISO country, or "all" for every storefront'),
  lang: z.string().optional().describe('Language code, or "all" for multi-language'),
  max: z.number().int().positive().max(5000).optional(),
  sort: z.string().optional().describe('newest | rating | helpful …'),
  stars: z.string().optional().describe('e.g. "1,2"'),
  minRating: z.number().min(1).max(5).optional(),
  maxRating: z.number().min(1).max(5).optional(),
  keyword: z.string().optional(),
  allKeywords: z.string().optional().describe('All words must match'),
  anyKeyword: z.string().optional().describe('Any word matches'),
  dateFrom: z.string().optional().describe('YYYY-MM-DD'),
  dateTo: z.string().optional().describe('YYYY-MM-DD'),
  version: z.string().optional(),
  minLength: z.number().int().nonnegative().optional(),
  replyOnly: z.boolean().optional().describe('Only reviews with a developer reply'),
};

const ro = { readOnlyHint: true, openWorldHint: true };

// OwlASO flags: lite/track expect "1"; replyOnly expects "true".
const flag = (v) => (v ? '1' : undefined);

// Keeps per-group stats but caps the review rows so full data fits a model context.
export function capFullReviews(data, perGroup) {
  let omitted = 0;
  const groups = (data.groups || []).map((g) => {
    const reviews = g.reviews || [];
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
    schema: { q: z.string().min(1), platform: z.enum(['all', 'google', 'apple']).default('all'), country, lang, limit: z.number().int().positive().max(50).optional() },
    route: '/api/search',
  },
  {
    name: 'analyze_keyword',
    description: 'ASO keyword analysis for one country: popularity, difficulty, opportunity, ranking apps, similar keywords, competitor keywords. Set lite to skip competitor probes and history. track keeps a history snapshot on lite runs.',
    schema: { keyword: z.string().min(2), store, country, lang, limit: z.number().int().positive().max(50).optional(), lite: z.boolean().optional(), track: z.boolean().optional() },
    route: '/api/asosearch',
    map: ({ keyword, lite, track, ...rest }) => ({ q: keyword, lite: flag(lite), track: flag(track), ...rest }),
  },
  {
    name: 'keyword_history',
    description: 'Daily rank/score snapshots (up to 180 days) for a keyword × store × country × language.',
    schema: { keyword: z.string().min(2), store, country, lang },
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
