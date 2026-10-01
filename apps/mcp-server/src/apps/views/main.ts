import { App } from '@modelcontextprotocol/ext-apps';
import { h } from './dom';
import {
  type ViewActions,
  renderComparison,
  renderEvidence,
  renderExplain,
  renderInterpretation,
  renderMatches,
  renderOffering,
  renderRequestForm,
  renderRequirementDraft,
  renderVideos,
} from './render';
import { STYLES } from './styles';

declare global {
  interface Window {
    ATX_VIEW?: string;
  }
}

/** Entry point shared by all ATX MCP App views; the HTML wrapper sets window.ATX_VIEW. */
const view = window.ATX_VIEW ?? 'unknown';
const style = document.createElement('style');
style.textContent = STYLES;
document.head.append(style);
const root = h('main', {}, h('p', { class: 'muted' }, 'Waiting for data…'));
document.body.append(root);

const app = new App({ name: `atx-${view}`, version: '1.0.0' });
let lastInput: Record<string, unknown> | null = null;

const actions: ViewActions = {
  openLink: (url) => void app.openLink({ url }),
  callTool: async (name, args) => {
    const result = await app.callServerTool({ name, arguments: args });
    const text = result.content?.find((block) => block.type === 'text');
    return {
      structuredContent: result.structuredContent,
      isError: result.isError,
      text: text && 'text' in text ? String(text.text) : undefined,
    };
  },
};

const render = (data: Record<string, unknown>): HTMLElement => {
  switch (view) {
    case 'compatibility-matrix':
      return 'match' in data ? renderExplain(data as never, actions) : renderMatches(data as never, actions);
    case 'offering-card':
      return renderOffering(data as never, actions);
    case 'comparison':
      return renderComparison(data as never, actions);
    case 'video-player':
      return renderVideos(data as never, actions);
    case 'evidence-viewer':
      return renderEvidence(data as never, actions);
    case 'requirement-builder':
      return 'requirement' in data
        ? renderRequirementDraft(data as never, actions)
        : renderInterpretation(data as never, actions);
    case 'request-form':
      return renderRequestForm(data as never, lastInput, actions);
    default:
      return h('p', {}, 'Unknown view.');
  }
};

app.ontoolinput = (params) => {
  lastInput = (params.arguments ?? null) as Record<string, unknown> | null;
};
app.ontoolresult = (result) => {
  if (result.isError || !result.structuredContent) {
    const text = result.content?.find((block) => block.type === 'text');
    root.replaceChildren(h('p', {}, text && 'text' in text ? String(text.text) : 'The request failed.'));
    return;
  }
  root.replaceChildren(render(result.structuredContent as Record<string, unknown>));
};

await app.connect();
