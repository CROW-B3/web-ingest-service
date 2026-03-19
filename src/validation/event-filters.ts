const DROPPED_EVENT_TYPES = new Set([
  'hover',
  'visibility',
  'engagement',
  'form_focus',
]);

const GATED_EVENT_TYPES = new Set(['rage_click', 'scroll', 'navigation']);

export function shouldStoreEvent(
  eventType: string,
  gatedEventsEnabled = false
): boolean {
  if (DROPPED_EVENT_TYPES.has(eventType)) return false;
  if (GATED_EVENT_TYPES.has(eventType)) return gatedEventsEnabled;
  return true;
}
