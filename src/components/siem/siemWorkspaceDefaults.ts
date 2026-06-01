export const SIEM_DEFAULT_WORKSPACE_CONFIG = {
  sizes: [0, 1],
  master: {
    widgets: [],
    sizes: [],
  },
  detail: {
    main: {
      type: 'split-area',
      orientation: 'vertical',
      sizes: [0.35, 0.65],
      children: [
        { type: 'tab-area', widgets: ['v0'], currentIndex: 0 },
        { type: 'tab-area', widgets: ['v1', 'v2'], currentIndex: 0 },
      ],
    },
    sizes: [1],
  },
  viewers: {
    v0: {
      title: 'Event Velocity',
      table: 'events',
      plugin: 'Y Line',
      group_by: ['timeSlot'],
      split_by: ['eventType'],
      aggregates: { count: 'sum' },
      columns: ['count'],
      sort: [['timeSlot', 'asc']],
      settings: true,
    },
    v1: {
      title: 'Event Log',
      table: 'events',
      plugin: 'Datagrid',
      columns: ['timestampLocal', 'eventType', 'severity', 'source', 'target', 'account', 'action'],
      sort: [['timestampLocal', 'desc']],
      settings: true,
    },
    v2: {
      title: 'Threat Indicators',
      table: 'threats',
      plugin: 'Datagrid',
      columns: ['valid_from', 'name', 'pattern_type', 'pattern', 'description'],
      sort: [['valid_from', 'desc']],
      settings: true,
    },
  },
} as const;
