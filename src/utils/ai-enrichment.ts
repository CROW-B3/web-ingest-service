import { logger } from './logger';

interface ClickElementInfo {
  text?: string;
  ariaLabel?: string;
}

function buildClickEnrichmentPrompt(
  element: ClickElementInfo,
  page: string
): string {
  const label = element.ariaLabel || element.text || 'unknown element';
  return `Describe what the user did: clicked "${label}" on page "${page}"`;
}

function extractElementInfo(data: Record<string, unknown>): ClickElementInfo {
  const element = data.element as Record<string, unknown> | undefined;
  if (element) {
    return {
      text: element.text as string | undefined,
      ariaLabel: element.ariaLabel as string | undefined,
    };
  }
  return {
    text: data.text as string | undefined,
    ariaLabel: data.ariaLabel as string | undefined,
  };
}

export async function enrichClickEventWithAiContext(
  ai: Ai,
  page: string,
  data: Record<string, unknown>
): Promise<string | null> {
  const element = extractElementInfo(data);

  if (!element.text && !element.ariaLabel) return null;

  try {
    const prompt = buildClickEnrichmentPrompt(element, page);
    const result = (await ai.run(
      '@cf/meta/llama-3.1-8b-instruct' as any,
      {
        messages: [{ role: 'user', content: prompt }],
      },
      { gateway: { id: 'crow-ai-gateway', skipCache: false } }
    )) as { response?: string };

    return result.response || null;
  } catch (error) {
    logger.warn({ error }, 'AI enrichment failed for click event');
    return null;
  }
}
