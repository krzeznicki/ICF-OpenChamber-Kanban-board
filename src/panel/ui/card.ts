// One task card: title, id, badges (type, ready-for-human, wontfix, blocked) and, for a parent,
// its done/total sub-tasks with a progress bar. Read-only in this task.
import { mountBadge, mountProgress } from '@openchamber/sdk/ui';
import type { Tone } from '@openchamber/sdk/ui';
import type { CardModel } from '../columns.ts';

const typeTone = (type: string): Tone => (type === 'bug' ? 'error' : type === 'enhancement' ? 'info' : 'neutral');

export type CardHandle = { node: HTMLElement; dispose: () => void };

export const renderCard = (model: CardModel): CardHandle => {
  const { task } = model;
  const disposers: Array<() => void> = [];
  const node = document.createElement('article');
  node.className = model.child ? 'kb-card is-child' : 'kb-card';
  node.dataset.taskId = task.id;

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

  return {
    node,
    dispose: () => {
      for (const d of disposers) d();
      node.remove();
    },
  };
};
