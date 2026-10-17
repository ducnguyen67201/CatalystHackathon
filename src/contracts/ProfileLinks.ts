import { z } from 'zod';

/** Canonical identity seed. URLs are search hints, never directly fetched by this service. */
export function parseInvestorUrl(input: string): string {
  const value = input.includes('://') ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Investor URL must be a public LinkedIn, X, or firm URL.');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) ||
    /\.(local|localhost|internal|test|invalid)$/.test(host)
  ) {
    throw new Error('Investor URL must use HTTPS and a public domain without credentials.');
  }
  url.hostname = host === 'twitter.com' ? 'x.com' : host;
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (url.hostname === 'x.com') {
    if (
      !/^\/[a-zA-Z0-9_]{1,15}$/.test(url.pathname) ||
      /^\/(home|search|explore|notifications|messages|settings|i)$/i.test(url.pathname)
    ) {
      throw new Error('Investor URL must point to an X profile, not a post or search page.');
    }
    url.pathname = url.pathname.toLowerCase();
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    if (!/^\/(in|company)\/[^/]+$/.test(url.pathname)) {
      throw new Error('Investor URL must point to a LinkedIn person or company profile.');
    }
    url.hostname = 'linkedin.com';
    url.pathname = url.pathname.toLowerCase();
  }
  return url.href;
}

export const publicProfileUrlSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value, context) => {
    try {
      return parseInvestorUrl(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Use a public HTTPS profile or firm URL.' });
      return z.NEVER;
    }
  });
