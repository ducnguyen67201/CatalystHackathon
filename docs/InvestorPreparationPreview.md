# Investor preparation UI preview

Status: interactive design mockup. Application behavior is unchanged.

Open [the clickable preview](previews/InvestorPreparationPreview.html).

The flow has three steps: prepare, practise and review. The existing June palette,
serif headings and quiet evidence presentation connect this concept to the app.

1. In **Prepare**, switch between two fictional investors to compare preparation
   emphasis on identical company figures. Select **New investor** to inspect the
   limited-context state.
2. Open **Why this emphasis?**, either question's **Why?**, or **Inspect the source
   rows**. A right-side explanation connects investor context, company evidence,
   the preparation hypothesis and the answer's objective.
3. Choose **Practise this conversation** and select a sample answer. Depending on
   the answer, Vicky corrects a conclusion, pivots the metric, keeps focus,
   requests missing evidence or clarifies the question. **Try another answer**
   returns to the choices. Investor selection is fixed during practice.
4. Open **Why this focus?** beside the response to inspect its specific context.
5. Choose **See practice review** for the selected answer's feedback, a supported
   example answer and an evidence checklist. Rehearse another answer or return
   to investor preparation.

Every investor, quotation, company figure, CSV locator and response is fictional.
The interface uses scripted choices and page-memory state, not a working AI
classifier. It makes no network requests or paid provider calls and does not
save financial or rehearsal records. Currency is unconfirmed. Cash-flow,
retention and advertising inputs are deliberately missing.

This previews the proposed guided text flow. Question synchronization in live
voice/video remains a separate implementation step. The sidebar supplies visual
workspace context; only the preparation flow is interactive.

See [the implementation plan](InvestorPreparationPlan.md) for the backend,
contracts, source validation and delivery sequence.
