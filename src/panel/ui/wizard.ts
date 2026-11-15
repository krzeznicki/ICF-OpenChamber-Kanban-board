// The setup wizard for a project without docs/agents/issue-tracker.md: pick Local or GitHub,
// press one button. main.ts does the work (initConfig, then load) through onSetup.
import { mountButton, mountList } from '@openchamber/sdk/ui';
import { type TrackerChoice } from '../setup.ts';

export type WizardProps = {
  /** The github.com remote the service detected, or null. */
  remote: string | null;
  initial: TrackerChoice;
  onSetup: (choice: TrackerChoice) => void;
};

export type WizardHandle = { setBusy: (busy: boolean) => void; dispose: () => void };

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const mountWizard = (root: HTMLElement, props: WizardProps): WizardHandle => {
  let choice: TrackerChoice = props.initial;
  let busy = false;
  const wrap = element('section', 'kb-wizard');
  const title = element('h2', 'kb-wizard-title', 'Set up a task board for this project');
  const body = element(
    'p',
    'kb-wizard-body',
    'Choose where the tasks live. ICF-kanban writes docs/agents/issue-tracker.md in the format the agent skills read.',
  );
  const listSlot = element('div', 'kb-wizard-choices');
  const actions = element('div', 'kb-wizard-actions');
  wrap.append(title, body, listSlot, actions);
  root.append(wrap);

  const list = mountList(listSlot, {
    ariaLabel: 'Tracker',
    selectedId: choice,
    items: [
      { id: 'local', title: 'Local', subtitle: 'Markdown files under .scratch/ in this repository' },
      {
        id: 'github',
        title: 'GitHub',
        subtitle:
          props.remote === null
            ? 'Issues of the repository’s GitHub remote (none found); needs the gh CLI'
            : `Issues of ${props.remote}; creates the missing labels, needs the gh CLI`,
        ...(props.remote !== null ? { badge: { label: 'remote found', tone: 'success' as const } } : {}),
      },
    ],
    onSelect: (id) => {
      if (busy || (id !== 'local' && id !== 'github')) return;
      choice = id;
      list.update({ selectedId: id });
    },
  });
  const button = mountButton(actions, {
    label: 'Set up board',
    onClick: () => {
      if (!busy) props.onSetup(choice);
    },
  });

  return {
    setBusy: (next) => {
      busy = next;
      button.update({ loading: next, disabled: next });
    },
    dispose: () => {
      list.dispose();
      button.dispose();
      wrap.remove();
    },
  };
};
