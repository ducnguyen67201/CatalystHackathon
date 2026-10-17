export const Page = {
  OVERVIEW: 'overview',
  MEETINGS: 'meetings',
  RADAR: 'radar',
  INVESTORS: 'investors',
  FINANCIALS: 'financials',
  BRIEF: 'brief',
  PRACTICE: 'practice',
  FOLLOWUPS: 'followups',
  ROOM: 'room',
} as const;
export type Page = (typeof Page)[keyof typeof Page];

export function readWorkspacePage(location: Pick<Location, 'pathname' | 'search'>): Page {
  if (location.pathname === '/scenarios') return Page.PRACTICE;
  if (location.pathname === '/practice' || location.pathname === '/voice') return Page.ROOM;
  const params = new URLSearchParams(location.search);
  if (params.get('page') === Page.MEETINGS) return Page.RADAR;
  if (params.has('radarEvent')) return Page.RADAR;
  if (params.has('followups')) return Page.FOLLOWUPS;
  return Object.values(Page).find((page) => page === params.get('page')) ?? Page.OVERVIEW;
}

export function workspacePageHref(page: Page): string {
  if (page === Page.MEETINGS) return '/?page=radar';
  if (page === Page.PRACTICE) return '/scenarios';
  if (page === Page.ROOM) return '/practice';
  return page === Page.OVERVIEW ? '/' : '/?page=' + page;
}
