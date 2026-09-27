/**
 * Pi stores a hook follow-up as an ordinary user-role entry. The Runtime marks
 * the entries it injects with this durable entry label, so presentation and
 * evidence never mistake them for something the user said. The label is set
 * by the Runtime itself; message text is never used to recognize one.
 */
export const RUNTIME_INJECTED_LABEL = "data-agent:runtime-injected";

export function isRuntimeInjected(label: string | undefined): boolean {
  return label === RUNTIME_INJECTED_LABEL;
}
