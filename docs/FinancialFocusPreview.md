# Financial blind spots and investor lenses

Status: interactive concept; production implementation is not included.
Open [the HTML mockup](previews/FinancialFocusPreview.html).

The minimal view answers three questions: what needs explaining, what the evidence
shows, and what to prepare next. A short four-item list opens one focused detail
panel. A single investor selector changes the suggested emphasis and practice
question while preserving the source figures.

The four examples cover credit-backed positive net income despite an operating
loss; rising revenue with falling gross margin; unsupported runway; and an
unverified ROAS claim that needs advertising and customer inputs.

Exact worksheet evidence opens on demand with highlighted cells. Missing evidence
opens a short input checklist instead of a spreadsheet with invented values. The
original pitch, a suggested stronger answer, and the full investor comparison are
available through disclosures. The initial view has no dashboard cards, charts,
relevance scores or repeated profile sections.

Two fictional thesis statements illustrate the investor selector:

- Harbor Capital: capital efficiency, durable margins and operating profitability.
- Summit Ventures: repeatable revenue growth and customer retention.

The thesis statement motivates a preparation hypothesis; it does not predict an
investor's personality, investment decision or exact future questions. **Why this
emphasis?** opens the selected fictional source.

## Try the interactions

1. Select a finding, then open its worksheet citation to inspect highlighted cells.
2. Select cells to inspect saved values or authored formulas.
3. Choose Cash runway or ROAS to reveal the missing inputs.
4. Switch **Preparing for** and compare the changed framing and practice question.
5. Open **Why this emphasis?**, **Try a stronger answer**, or **Compare the two
   investor lenses** for additional detail.
6. Expand the original pitch and select an underlined claim to inspect it.

Every company figure, transcript, workbook cell, investor and thesis quotation in
this preview is fictional. The supplied dashboard image provides visual context;
its amounts are not imported as company evidence. Controls run in page memory and
make no research, model, provider, email, database or paid interview calls.
Financial calculations shown here are authored demo values, not a working detector.

## Proposed implementation boundary

```text
Frozen financial evidence + saved transcript
                    |
       Supported findings + explicit missing inputs
                    |
       Claim -> evidence -> next preparation step
                    |
       Selected investor's cited preparation themes
                    |
       Different emphasis / same financial facts
```

A working version should use Decimal.js, validated source references and saved
investor research, showing limited context where sources are unavailable. Do not
infer industry averages, churn, CAC, cash burn, runway or revenue concentration
from an income statement alone. Native Excel intake, QuickBooks, benchmarks and
what-if forecasts remain separate work.
