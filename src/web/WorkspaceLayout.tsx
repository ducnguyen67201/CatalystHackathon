import { useState, type ReactNode } from 'react';
import {
  Activity,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Radar,
  Search,
  Target,
} from 'lucide-react';
import { Page } from './WorkspaceNavigation.js';

export function WorkspaceLayout({
  page,
  onNavigate,
  researchReady,
  unread,
  onNotifications,
  children,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  researchReady: boolean;
  unread: number;
  onNotifications: () => void;
  children: ReactNode;
}) {
  const [sidebarLabelsDismissed, setSidebarLabelsDismissed] = useState(false);
  const nav = [
    { id: Page.OVERVIEW, label: 'Overview', icon: LayoutDashboard },
    { id: Page.MEETINGS, label: 'Meetings', icon: CalendarDays },
    { id: Page.RADAR, label: 'Investor radar', icon: Radar },
    { id: Page.INVESTORS, label: 'Investor research', icon: Search },
    { id: Page.FINANCIALS, label: 'Financials', icon: ChartNoAxesCombined },
    { id: Page.BRIEF, label: 'Meeting brief', icon: FileText },
    { id: Page.PRACTICE, label: 'Practice scenario', icon: MessageSquare },
    { id: Page.FOLLOWUPS, label: 'Follow-ups', icon: Target },
  ];
  return (
    <div className="layout dashboard-layout">
      <aside
        className="workspace-sidebar"
        aria-label="Workspace sidebar"
        data-labels-dismissed={sidebarLabelsDismissed}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setSidebarLabelsDismissed(true);
        }}
        onFocus={() => setSidebarLabelsDismissed(false)}
        onPointerOver={() => setSidebarLabelsDismissed(false)}
      >
        <button
          className="brand brand-home"
          aria-label="June home"
          onClick={() => {
            onNavigate(Page.OVERVIEW);
          }}
        >
          j<small className="brand-wordmark">une</small>
          <span />
        </button>
        <nav className="workspace-nav" aria-label="Workspace">
          {nav.map((item) => (
            <button
              key={item.id}
              className={(page === Page.ROOM ? Page.PRACTICE : page) === item.id ? 'active' : ''}
              aria-label={item.label}
              aria-current={
                (page === Page.ROOM ? Page.PRACTICE : page) === item.id ? 'page' : undefined
              }
              onClick={() => {
                onNavigate(item.id);
              }}
            >
              <item.icon size={18} aria-hidden="true" />
              <span className="sidebar-label" aria-hidden="true">
                {item.label}
              </span>
            </button>
          ))}
        </nav>
        <div className="workspace-status">
          <span
            className="workspace-research-status"
            tabIndex={0}
            role="img"
            aria-label={researchReady ? 'Live research' : 'Research not configured'}
            data-ready={researchReady}
          >
            <Activity size={18} aria-hidden="true" />
            <span className="sidebar-label demo-badge" aria-hidden="true">
              {researchReady ? 'Live research' : 'Research not configured'}
            </span>
          </span>
          <button
            className="notification-button"
            aria-label={`Notifications, ${unread} unread`}
            onClick={() => {
              onNotifications();
            }}
          >
            <Bell size={18} aria-hidden="true" />
            {unread > 0 && <i />}
            <span className="sidebar-label" aria-hidden="true">
              Notifications, {unread} unread
            </span>
          </button>
        </div>
      </aside>
      {children}
    </div>
  );
}
