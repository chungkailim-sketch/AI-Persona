/**
 * Modules: the parts of the platform a project uses, chosen per use case and client brief.
 *
 * A project picks a use case, which switches on a preset set of modules; the team can then turn
 * individual modules on or off. The five steps always exist — a module switched off simply does
 * not appear (a section, a slide, a panel), so the journey stays short for each use case.
 */

export const MODULES = [
  { key: 'roundtable', label: 'Roundtable', description: 'Every persona scores the categories; heatmaps and voices in the report.' },
  { key: 'interviews', label: 'Persona interviews', description: 'Open any persona and interview it.' },
  { key: 'debate', label: 'Agent swarm debate', description: 'Personas debate a motion; a judge and the Decisions API weigh the outcome.' },
  { key: 'decisions', label: 'Decision guidance', description: 'OpenAI Decisions API recommendations at each checkpoint.' },
  { key: 'market_potential', label: 'Market potential map', description: 'Composite index and map of priority markets.' },
  { key: 'market_entry', label: 'Market entry heatmap', description: 'Entry index and category barriers by market.' },
  { key: 'persona_profiles', label: 'Persona profile slides', description: 'One report slide per persona.' },
  { key: 'comms_planner', label: 'PR, comms and marketing planner', description: 'Plans that answer the team’s questions from the data.' },
  { key: 'knowledge', label: 'Knowledge library', description: 'Curated PR, comms, marketing and market-entry knowledge.' },
  { key: 'about_slide', label: '“About the engine” slide', description: 'The rf.AI Persona explainer slide in the report.' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];

const ALL = MODULES.map((m) => m.key) as ModuleKey[];

export const USE_CASES = [
  { key: 'market_entry', label: 'Market entry', description: 'Which markets and categories to enter, and how to launch.', modules: ALL },
  { key: 'campaign', label: 'Campaign and message testing', description: 'Test messages and plan a campaign with the target audiences.', modules: ['roundtable', 'interviews', 'debate', 'decisions', 'persona_profiles', 'comms_planner', 'knowledge', 'about_slide'] as ModuleKey[] },
  { key: 'brand_health', label: 'Brand perception', description: 'How audiences see the brand and its category, by segment.', modules: ['roundtable', 'interviews', 'decisions', 'persona_profiles', 'comms_planner', 'about_slide'] as ModuleKey[] },
  { key: 'crisis', label: 'Issues and crisis preparedness', description: 'Rehearse how audiences react to an issue, and plan the response.', modules: ['interviews', 'debate', 'decisions', 'comms_planner', 'knowledge'] as ModuleKey[] },
  { key: 'custom', label: 'Custom', description: 'Choose the modules yourself.', modules: ALL },
] as const;

export type UseCaseKey = (typeof USE_CASES)[number]['key'];

/** The modules a project has on: its own choice if it made one, otherwise its use case's preset. */
export function activeModules(project: { useCase: string; modules: string[] }): Set<ModuleKey> {
  if (project.modules.length) return new Set(project.modules.filter((m): m is ModuleKey => (ALL as string[]).includes(m)));
  const preset = USE_CASES.find((u) => u.key === project.useCase) ?? USE_CASES[0];
  return new Set(preset.modules);
}
