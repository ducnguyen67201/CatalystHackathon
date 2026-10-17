import { describe, expect, it } from 'vitest';
import { Page, readWorkspacePage, workspacePageHref } from '../src/web/WorkspaceNavigation.js';
import { practiceHref, readScenarioRoute } from '../src/contracts/ScenarioNavigation.js';

describe('shared workspace navigation', () => {
  it.each(['/practice', '/voice'])(
    'opens %s in the practice room without losing the saved scenario',
    (pathname) => {
      const selection = {
        generationId: 'af3d5c70-f34b-4a51-8796-76fae5e7a222',
        scenarioId: 'explain-your-company',
      };
      const url = new URL(practiceHref(selection), 'http://127.0.0.1');
      url.pathname = pathname;
      expect(readWorkspacePage(url)).toBe(Page.ROOM);
      expect(readScenarioRoute(url.search)).toEqual({ kind: 'scenario', selection });
    },
  );

  it.each(Object.values(Page))('restores the %s page from its navigation URL', (page) => {
    const url = new URL(workspacePageHref(page), 'http://127.0.0.1');
    expect(readWorkspacePage(url)).toBe(page);
  });

  it('preserves radar notification deep links', () => {
    const url = new URL('http://127.0.0.1/?radarEvent=saved-event');
    expect(readWorkspacePage(url)).toBe(Page.RADAR);
  });

  it('preserves practice follow-up deep links', () => {
    const url = new URL('http://127.0.0.1/?followups=saved-followup');
    expect(readWorkspacePage(url)).toBe(Page.FOLLOWUPS);
  });

  it('uses overview for an unknown page', () => {
    const url = new URL('http://127.0.0.1/?page=unknown');
    expect(readWorkspacePage(url)).toBe(Page.OVERVIEW);
  });
});
