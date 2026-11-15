// One task card: title, id, badges (session, type, ready-for-human, wontfix, blocked) and, for a parent,
// its done/total sub-tasks with a progress bar. Focusable: Enter opens it (its agent session when it
// has one, else the detail), and a press starts a drag (ui/dnd.ts). A card with a session also has a
// Details button for the detail sheet. A card whose move is in flight is drawn busy.
import { mountBadge, mountButton, mountProgress } from '@openchamber/sdk/ui';
import type { Tone } from '@openchamber/sdk/ui';
import type { CardModel, SessionInfo } from '../columns.ts';

const typeTone = (type: string): Tone => (type === 'bug' ? 'error' : type === 'enhancement' ? 'info' : 'neutral');

/** The session badge: what the agent is doing, or how it ended. */
export const sessionBadge = (s: SessionInfo): { label: string; tone: Tone } => {
  switch (s.activity) {
    case 'running':
    case 'retrying':
      return { label: 'agent working', tone: 'info' };
    case 'waiting-permission':
    case 'waiting-question':
      return { label: 'agent needs you', tone: 'warning' };
    default:
      return s.outcome === 'failed'
        ? { label: 'agent failed', tone: 'error' }
        : s.outcome === 'completed'
          ? { label: 'agent finished', tone: 'success' }
          : { label: 'agent idle', tone: 'neutral' };
  }
};

export type CardHandle = { node: HTMLElement; dispose: () => void };

export const renderCard = (model: CardModel, busy = false, onDetails?: (taskId: string) => void): CardHandle => {
  const { task } = model;
  const disposers: Array<() => void> = [];
  const node = document.createElement('article');
  node.className = model.child ? 'kb-card is-child' : 'kb-card';
  node.dataset.taskId = task.id;
  node.tabIndex = 0;
  node.setAttribute('aria-label', `${task.title} (${task.id})`);
  if (busy) {
    node.classList.add('is-busy');
    node.setAttribute('aria-busy', 'true');
  }

  const title = document.createElement('div');
  title.className = 'kb-card-title';
  title.textContent = task.title;
  const id = document.createElement('div');
  id.className = 'kb-card-id';
  id.textContent = task.id;
  node.append(title, id);

  const badges = document.createElement('div');
  badges.className = 'kb-badges';
  const badge = (label: string, tone: Tone): void => {
    disposers.push(mountBadge(badges, { label, tone }).dispose);
  };
  if (model.session !== null) {
    const b = sessionBadge(model.session);
    badge(b.label, b.tone);
  } else if (model.starting) {
    badge('starting agent…', 'info');
  }
  if (task.kind === 'parent') badge('parent', 'primary');
  if (task.type !== null) badge(task.type, typeTone(task.type));
  if (task.state === 'ready-for-human') badge('ready-for-human', 'warning');
  if (task.state === 'wontfix') badge('wontfix', 'neutral');
  if (model.blockers.length > 0) badge(`blocked by ${model.blockers.length}`, 'error');
  node.append(badges);
  if (model.blockers.length > 0) badges.title = `Waiting for: ${model.blockers.join(', ')}`;

  if (model.progress !== null && model.progress.total > 0) {
    const { done, total } = model.progress;
    const wrap = document.createElement('div');
    wrap.className = 'kb-progress';
    const label = document.createElement('div');
    label.className = 'kb-progress-label';
    label.textContent = `${done}/${total} sub-tasks done`;
    wrap.append(label);
    disposers.push(
      mountProgress(wrap, { value: Math.round((done / total) * 100), tone: done === total ? 'success' : 'primary' }).dispose,
    );
    node.append(wrap);
  }

  if (model.session !== null) {
    node.title = 'Open the agent session';
    const actions = document.createElement('div');
    actions.className = 'kb-card-actions';
    disposers.push(
      mountButton(actions, { label: 'Details', variant: 'ghost', size: 'xs', onClick: () => onDetails?.(task.id) }).dispose,
    );
    node.append(actions);
  }

  return {
    node,
    dispose: () => {
      for (const d of disposers) d();
      node.remove();
    },
  };
};
