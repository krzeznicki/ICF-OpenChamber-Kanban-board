// A notice in the board's status slot: the error message and one button (Retry, or Open board
// after setup). The button re-runs the load; main.ts passes that in.
import { mountBanner } from '@openchamber/sdk/ui';
import type { NoticeModel } from '../setup.ts';

export const mountNotice = (root: HTMLElement, model: NoticeModel, onAction: () => void): (() => void) =>
  mountBanner(root, {
    tone: model.tone,
    title: model.title,
    body: model.body,
    action: { label: model.action, onClick: onAction },
  }).dispose;
