export type ProjectTabId =
  'architecture' | 'observability' | 'logs' | 'audit' | 'settings';

export type ProjectTab = {
  id: ProjectTabId;
  label: string;
};

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'architecture';

/** Query parameter that holds the selected tab, so a reload keeps it. */
export const PROJECT_TAB_PARAM = 'tab';

export const PROJECT_TABS: ProjectTab[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'observability', label: 'Usage Metrics' },
  { id: 'logs', label: 'Logs' },
  { id: 'audit', label: 'Audit Trail' },
  { id: 'settings', label: 'Settings' },
];

export const isProjectTabId = (value: unknown): value is ProjectTabId =>
  typeof value === 'string' && PROJECT_TABS.some((tab) => tab.id === value);

export const toProjectTabId = (value: unknown): ProjectTabId =>
  isProjectTabId(value) ? value : DEFAULT_PROJECT_TAB;

export const projectTabIndex = (id: ProjectTabId) =>
  PROJECT_TABS.findIndex((tab) => tab.id === id);

/** DOM ids that tie each tab to its panel for assistive technology. */
export const projectTabDomId = (id: ProjectTabId) => `project-tab-${id}`;
export const projectPanelDomId = (id: ProjectTabId) => `project-panel-${id}`;
