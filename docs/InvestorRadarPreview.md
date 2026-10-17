# Investor radar preview

The agreed delivery scope is documented in [Investor radar result delivery](InvestorRadarEngineeringSpec.md): consume committed classified research, show relevant updates in the radar, and notify the founder by email. The brief handoff and extraction-replay ideas in this earlier exploration are outside that release.

Open `previews/InvestorRadarPreview.html` directly or serve that directory on loopback. It is a self-contained, interactive concept with no requests to application APIs, persistence, credentials, or external assets. Source links open only when clicked. Northline, Tidewell, the investment announcement, and all completed-research examples are fictional. The Duc sample contains shortened passages supplied by the user; its proposed review labels are editorial interpretation, not model extraction output.

## Repository baseline

The preview was first built against remote `main` at `4140851` and research work at `4cd1e0c`. Before preparing the spec PR, remote `main` advanced to `45374a0`, merging `codex/investor-research`; this documentation branch starts from that merged baseline. There was no remote branch literally named `auto`. The supplied `docs/CODEX-NAVIGATION-GUIDE.md` path is absent in this checkout.

## Original workflow and reuse

1. Save the company profile, financial snapshot, meeting notes, and investor identity during onboarding. Main starts newly added onboarding investors paused; adding directly through the watchlist schedules an immediate check followed by daily monitoring.
2. Research runs use public identity hints and company segment criteria. Private financial rows are not sent to research providers.
3. Keep extracted evidence with source text, URL, retrieval time, and immutable versions. Per-investor checks retain evidence IDs, added/changed IDs, and the company profile version.
4. Radar reads those saved records for the investor summary, source passages, change history, and criterion-based fit. Reopening the view does not require another research call. Unknown criteria remain unknown; an extracted quote is provenance, not verification of truth or identity.
5. A meeting brief reuses saved evidence alongside its financial snapshot and company profile. Main's named-meeting path selects evidence from that investor's latest check or discovery record. Briefs pin one evidence ID today; a selectable set of sources would require a contract change.
6. Future scheduled or manual checks append history and source versions. Older evidence and briefs remain intact. A changed web page is not necessarily a new investment event.

Standalone voice and video currently use an empty context provider. Investor research is not automatically passed into those sessions. That adapter is separate implementation work.

## Mapping the supplied payload

| Supplied field                                 | Suggested destination / UI                                  |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `input`                                        | Target identity URL, linked to the tracked investor         |
| `query`                                        | Saved research search query                                 |
| `retrievedAt`                                  | Search retrieval time; Oct 16, 11:04 PM EDT in this sample  |
| `results[]`                                    | Original source records: title, URL, text, publication date |
| `stage: raw_exa_search`                        | Sources collected, not a completed investor profile         |
| `verified: false`                              | Unverified label; no verified badge                         |
| `extractionStatus: not_run_missing_openai_key` | Extraction blocked; zero extracted claims                   |

Main now defines `ResearchRun`, `ResearchSearch`, extraction decisions, and a source-only import schema. The pasted payload is not directly that schema: an adapter must validate it, wrap the query/results as a search, link the correct investor, and supply valid run metadata and company profile context. Do not invent a historical profile version. Imported runs cannot assert successful extraction or trusted evidence.

The sample matches the target LinkedIn URL but includes a White Star Capital namesake, a different LinkedIn profile, and an unrelated firm directory. Do not borrow the namesake's firm, investment range, or investments for this target. The sample target's investor role, thesis, and check size remain unestablished.

## Existing support versus proposed UI

| Capability                                           | Status                                                 |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Tracked identities, monitoring, check history        | Main                                                   |
| Evidence versions, criterion fit, versioned brief    | Main                                                   |
| Full research runs, source-only imports, decisions   | Main (research branch merged)                          |
| Unified overview, sources, history, reuse tabs       | This preview proposal                                  |
| Resume extraction against an existing raw run        | Proposed backend work; not implemented by this preview |
| Human identity review and persisted source decisions | Proposed workflow; preview labels do not implement it  |
| Explicit source-selection handoff into brief         | Proposed UI and contract integration                   |
| Investor context in standalone voice/video           | Future context adapter                                 |

## Try the preview

- Select Northline for the fictional completed-research state, then preview the meeting brief.
- Select Duc for the supplied raw-result state. Open Sources to see why pages need identity review.
- Switch tabs with clicks or arrow keys. Filter the watchlist by name.
- Simulate a check to see a no-change or extraction-blocked history entry.
- Change monitoring to see the UI setting; it lives only in page memory.
- Open Data reuse for the input-to-output workflow and implementation boundary.

No research, extraction, provider calls, or database mutations occur from these preview controls.
