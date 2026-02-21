const DROPPED_EVENT_TYPES = new Set([
  'hover', 'visibility', 'engagement', 'form_focus',
]);

const GATED_EVENT_TYPES = new Set([
  'click', 'rage_click', 'scroll', 'navigation',
]);

export function shouldStoreEvent(eventType: string): boolean {
  return !DROPPED_EVENT_TYPES.has(eventType) && !GATED_EVENT_TYPES.has(eventType);
}
