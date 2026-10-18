import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StorySourceExcerpt } from '../src/web/StorySourceExcerpt.js';

describe('company story source presentation', () => {
  it('shows saved statement values without reformatting signs, currencies or precision and retains the original excerpt', () => {
    const excerpt = JSON.stringify({
      operating_income: '-$59,797.00',
      currency: 'CAD',
      net_income: '$122,503.00',
    });
    const html = renderToStaticMarkup(<StorySourceExcerpt excerpt={excerpt} />);
    expect(html).toContain('<table>');
    expect(html).toContain('<th scope="row">operating income</th><td>-$59,797.00</td>');
    expect(html).toContain('<th scope="row">currency</th><td>CAD</td>');
    expect(html).toContain('Original excerpt');
    expect(html).toContain('&quot;net_income&quot;:&quot;$122,503.00&quot;');
  });

  it.each(['Exact quoted passage.', '{broken json', '{"nested":{"amount":"12"}}', '[]'])(
    'keeps non-row source text verbatim: %s',
    (excerpt) => {
      const html = renderToStaticMarkup(<StorySourceExcerpt excerpt={excerpt} />);
      expect(html).toContain('<pre>');
      expect(html).not.toContain('<table>');
      expect(html).not.toContain('[object Object]');
    },
  );
});
