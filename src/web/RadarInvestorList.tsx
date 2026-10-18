import { Building2, ChevronRight } from 'lucide-react';
import type { RadarInvestorGroup } from '../contracts/RadarDelivery.js';

export function RadarInvestorList({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: RadarInvestorGroup[];
  selectedKey: string;
  onSelect: (group: RadarInvestorGroup) => void;
}) {
  return (
    <nav className="radar-investor-list" aria-label="Investors in Radar">
      <div className="radar-list-title">
        <strong>Investors</strong>
        <span>{groups.length}</span>
      </div>
      {groups.length === 0 && <p className="muted">No investors yet. Find investors to begin.</p>}
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          className="radar-person"
          aria-current={selectedKey === group.key ? 'true' : undefined}
          onClick={() => onSelect(group)}
        >
          <Building2 size={18} aria-hidden="true" />
          <span>
            <strong>{group.name}</strong>
            <small>
              {group.updateCount} {group.updateCount === 1 ? 'update' : 'updates'} ·{' '}
              {group.investorId ? 'Tracked' : 'Lead'}
            </small>
          </span>
          {group.unreadCount > 0 ? (
            <span
              className="radar-person-count"
              aria-label={`${group.unreadCount} unread ${group.unreadCount === 1 ? 'update' : 'updates'}`}
            >
              {group.unreadCount}
            </span>
          ) : (
            <ChevronRight size={15} aria-hidden="true" />
          )}
        </button>
      ))}
    </nav>
  );
}
