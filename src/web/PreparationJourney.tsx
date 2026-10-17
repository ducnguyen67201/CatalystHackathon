import { useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type { PreparationView } from '../contracts/FundraisingPreparation.js';
import {
  buildJourney,
  journeyStatusLabels,
  type JourneyAction,
} from './PreparationJourneyModel.js';
import './PreparationJourney.css';

export function PreparationJourney({
  data,
  onAction,
}: {
  data: PreparationView;
  onAction: (action: JourneyAction) => void;
}) {
  const nodes = useMemo(() => buildJourney(data), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const select = (id: string) => setSelectedId(id);
  const suggested =
    nodes.find(
      (node) =>
        node.id !== 'current' && (node.status === 'needs_review' || node.status === 'available'),
    ) ?? nodes[0];
  const selected = nodes.find((node) => node.id === selectedId) ?? suggested;
  if (!selected) return null;
  const complete = data.milestones.filter((node) => node.status === 'complete').length;
  const fictional = data.plan?.artifacts.some((artifact) => artifact.fictional);
  return (
    <section className="preparation-journey" aria-labelledby="preparation-journey-title">
      <div className="journey-heading">
        <div>
          <span className="eyebrow">Next preparation actions</span>
          <h3 id="preparation-journey-title">Turn the financial review into your next action.</h3>
        </div>
        <span className="journey-count">{complete} / 5 preparation gates reviewed</span>
      </div>
      {data.outdated && (
        <p className="journey-stale" role="status">
          Evidence changed. This chart shows the previous plan until it is refreshed.
        </p>
      )}
      {fictional && <span className="progress-tag tone-demo">Fictional demo evidence</span>}
      <div className="journey-step-buttons" aria-label="Explore preparation steps">
        {nodes
          .filter((node) => node.id !== 'current' && node.id !== 'target')
          .map((node) => (
            <button
              key={node.id}
              type="button"
              aria-pressed={selected.id === node.id}
              onClick={() => select(node.id)}
            >
              {node.status === 'complete' ? <Check size={13} aria-hidden="true" /> : null}
              {node.id === 'current'
                ? 'Current position'
                : node.id === 'target'
                  ? 'Your target'
                  : node.title}
            </button>
          ))}
      </div>
      <div className="journey-action" aria-live="polite">
        <div>
          <span className="eyebrow">
            {selected.id === 'current'
              ? 'You are here'
              : selected.id === 'target'
                ? 'Where you can go'
                : journeyStatusLabels[selected.status]}
          </span>
          <h4>{selected.title}</h4>
          <p>{selected.detail}</p>
        </div>
        <button className="button" type="button" onClick={() => onAction(selected.action)}>
          {selected.actionLabel} <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <p className="journey-footnote">
        Progress describes reviewed preparation, not funding probability or projected business
        growth.
      </p>
    </section>
  );
}
