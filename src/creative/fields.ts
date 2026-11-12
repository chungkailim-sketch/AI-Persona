/**
 * The rows of the AIGC Creative Brief template, by section, keyed for the model and labelled exactly
 * as the template's "Field" column (the label is how the Word filler finds the row).
 */
export interface BriefField { key: string; label: string; section: string; hint: string }

export const BRIEF_FIELDS: BriefField[] = [
  // 1. Project basics
  { key: 'projectTitle', label: 'Project title', section: '1', hint: 'Short name, reused in file names' },
  { key: 'brand', label: 'Client / brand', section: '1', hint: 'The client and brand' },
  { key: 'owner', label: 'Brief owner', section: '1', hint: 'One accountable person' },
  { key: 'mode', label: 'Runway mode', section: '1', hint: 'Text to video, image to video, …' },
  { key: 'deliverable', label: 'Final deliverable', section: '1', hint: 'Single clip, multi-shot sequence, image set or loop' },
  // 2. Objective and output specs
  { key: 'objective', label: 'Business objective', section: '2', hint: 'One sentence: what the content must achieve' },
  { key: 'audience', label: 'Target audience', section: '2', hint: 'Who watches, and what they should think or do afterwards — from the personas' },
  { key: 'platform', label: 'Platform / placement', section: '2', hint: 'Where it runs; sets framing and pacing' },
  { key: 'ratio', label: 'Aspect ratio', section: '2', hint: '16:9, 9:16, 1:1, 4:3, 3:4 or 21:9' },
  { key: 'resolution', label: 'Resolution', section: '2', hint: 'Native first, upscale approved clips' },
  { key: 'clipLength', label: 'Clip length per generation', section: '2', hint: 'Commonly 5 or 10 seconds' },
  { key: 'runtime', label: 'Total runtime', section: '2', hint: 'Final cut including transitions' },
  { key: 'frameRate', label: 'Frame rate', section: '2', hint: 'Match the delivery platform' },
  { key: 'shots', label: 'Number of shots', section: '2', hint: 'Runtime / clip length, plus spares' },
  // 3. Concept and creative direction
  { key: 'concept', label: 'One-line concept', section: '3', hint: 'The idea in one sentence a stranger could picture' },
  { key: 'keyMessage', label: 'Key message', section: '3', hint: 'The single takeaway — from the roundtable key messaging' },
  { key: 'mood', label: 'Mood / emotion', section: '3', hint: 'Two or three specific feelings' },
  { key: 'narrative', label: 'Narrative beat', section: '3', hint: 'What changes from first frame to last' },
  { key: 'pacing', label: 'Pacing', section: '3', hint: 'Slow and cinematic, rhythmic, or fast cuts' },
  { key: 'toneRefs', label: 'Tone references', section: '3', hint: 'Films, campaigns or photographers, described in words' },
  // 4. Subject and scene
  { key: 'subject', label: 'Primary subject', section: '4', hint: 'One main subject per shot' },
  { key: 'subjectDetails', label: 'Subject details', section: '4', hint: 'Age, build, wardrobe, colours, distinguishing features' },
  { key: 'anchors', label: 'Consistency anchors', section: '4', hint: '3 to 5 traits repeated verbatim in every prompt' },
  { key: 'action', label: 'Action', section: '4', hint: 'One clear verb per shot' },
  { key: 'environment', label: 'Environment', section: '4', hint: 'Location, scale, background, weather' },
  { key: 'timeOfDay', label: 'Time of day / season', section: '4', hint: 'Drives light direction and colour temperature' },
  { key: 'secondary', label: 'Secondary elements', section: '4', hint: 'Props and background figures, minimal' },
  // 5. Camera and motion
  { key: 'shotType', label: 'Shot type', section: '5', hint: 'Wide, medium, close-up, extreme close-up or aerial' },
  { key: 'angle', label: 'Camera angle', section: '5', hint: 'Eye level, low, high, overhead, over-the-shoulder' },
  { key: 'lens', label: 'Lens / depth of field', section: '5', hint: 'Wide-angle, 35mm, 85mm, shallow or deep focus' },
  { key: 'cameraMove', label: 'Camera movement', section: '5', hint: 'One move per shot' },
  { key: 'subjectMove', label: 'Subject movement', section: '5', hint: 'Direction and speed, separate from the camera' },
  { key: 'speed', label: 'Motion speed', section: '5', hint: 'Slow motion, natural, time-lapse' },
  { key: 'intensity', label: 'Motion intensity', section: '5', hint: 'Subtle, moderate or dynamic' },
  // 6. Visual style and look
  { key: 'style', label: 'Overall style', section: '6', hint: 'Photoreal, cinematic live-action, 3D, illustration…' },
  { key: 'lighting', label: 'Lighting', section: '6', hint: 'Source, direction, quality' },
  { key: 'palette', label: 'Color palette', section: '6', hint: '3 to 5 named colours or hex values; dominant vs accent' },
  { key: 'texture', label: 'Texture / material', section: '6', hint: 'Film grain, matte, glossy…' },
  { key: 'filmLook', label: 'Film look', section: '6', hint: 'Stock or grade' },
  { key: 'composition', label: 'Composition', section: '6', hint: 'Centred, rule of thirds, negative space for text' },
  { key: 'styleRule', label: 'Style consistency rule', section: '6', hint: 'The 2 to 3 style words repeated in every prompt' },
  // 9. Final prompt assembly
  { key: 'mustNot', label: 'Must not appear', section: '9', hint: 'Unwanted elements' },
  { key: 'positive', label: 'Positive rewrite of each exclusion', section: '9', hint: 'Each exclusion as what you want instead' },
  { key: 'settings', label: 'Generation settings', section: '9', hint: 'Model, clip length, seed, variations per shot' },
  { key: 'version', label: 'Prompt version', section: '9', hint: 'v1, v2, v3' },
];

/** The per-shot prompts go in this row, one paragraph per shot. */
export const SHOTS_LABEL = 'Master prompt (per shot)';

export interface ShotPrompt { title: string; prompt: string }
export interface CreativeBriefContent { fields: Record<string, string>; shots: ShotPrompt[]; basis: string[] }
