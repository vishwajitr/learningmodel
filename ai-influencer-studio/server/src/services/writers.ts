import { styleSuffix } from '../../../shared/promptTemplates.js';
import {
  BACKGROUNDS, CAMERA_ANGLES, LANGUAGES, SCRIPT_SECTIONS,
  type ContentCategory, type Influencer, type Language, type Platform, type Scene, type Script,
  type ScriptSectionKey, type ScriptSections, type SocialContent, type Tone, type VideoDuration,
} from '../../../shared/types.js';
import { resolveLLM, TEMPLATE_LLM_ID } from '../providers/registry.js';
import { templateScript, templateSection, templateTitle } from './templates.js';

export interface ScriptInput {
  topic: string;
  category: ContentCategory;
  language: Language;
  duration: VideoDuration;
  tone: Tone;
  targetAudience: string;
  platform: Platform;
  callToAction: string;
}

const langName = (l: Language) => LANGUAGES.find((x) => x.code === l)!.label;

/** Approximate spoken words per second for pacing. */
export const WORDS_PER_SECOND: Record<Language, number> = { en: 2.5, hi: 2.3, mr: 2.2 };

function wordBudget(duration: number, language: Language) {
  const total = Math.round(duration * WORDS_PER_SECOND[language]);
  return {
    total,
    hook: Math.max(6, Math.round(3 * WORDS_PER_SECOND[language])),
    intro: Math.round(total * 0.15),
    main: Math.round(total * 0.55),
    engagement: Math.round(total * 0.1),
    cta: Math.round(total * 0.1),
  };
}

function personaBlock(inf: Influencer | null): string {
  if (!inf) return 'The speaker is a friendly Indian social-media creator.';
  return [
    `Name: ${inf.name}`,
    `Character: ${inf.characterType === 'human' ? 'realistic human influencer' : `animated cartoon influencer (${inf.cartoonStyle ?? '3d'})`}`,
    `Gender: ${inf.gender}, age about ${inf.age}`,
    `Personality: ${inf.personality}`,
    `Speaking style: ${inf.speakingStyle}`,
    `Niche: ${inf.niches.join(', ')}`,
    `Background: ${inf.backgroundStory}`,
  ].join('\n');
}

function languageRules(language: Language): string {
  if (language === 'hi')
    return 'Write in natural spoken Hindi using Devanagari script. Everyday Hinglish words people actually say (like "phone", "app", "tips", "follow") may stay in English, written in Devanagari or Latin as Indian creators commonly do. Avoid formal/shuddh Hindi.';
  if (language === 'mr')
    return 'Write in natural spoken Marathi using Devanagari script, the way a young Maharashtrian creator talks on Instagram. Common English words may stay in English. Avoid bookish Marathi.';
  return 'Write in natural spoken Indian English, casual and warm.';
}

const SCRIPT_SYSTEM = `You write short-form video scripts for Instagram influencers.
The script must sound like a real person talking to their phone camera: contractions, short sentences, natural fillers used sparingly, direct "you" address, rhetorical questions.
Never write like an article, essay or press release. No headings, emojis, hashtags, stage directions or bullet points inside the spoken text.
Only output the words the influencer speaks.`;

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short catchy working title for the reel' },
    hook: { type: 'string' },
    intro: { type: 'string' },
    main: { type: 'string' },
    engagement: { type: 'string' },
    cta: { type: 'string' },
  },
  required: ['title', 'hook', 'intro', 'main', 'engagement', 'cta'],
  additionalProperties: false,
} as const;

export interface WriterResult<T> {
  value: T;
  provider: string;
  isDemo: boolean;
}

export async function writeScript(
  input: ScriptInput,
  inf: Influencer | null,
): Promise<WriterResult<{ title: string; sections: ScriptSections }>> {
  const llm = await resolveLLM();
  if (!llm) {
    const sections = templateScript(input.language, {
      name: inf?.name ?? 'your creator',
      topic: input.topic,
      audience: input.targetAudience || 'you',
      cta: input.callToAction,
      tone: input.tone,
    });
    return { value: { title: templateTitle(input.language, input.topic), sections }, provider: TEMPLATE_LLM_ID, isDemo: true };
  }
  const b = wordBudget(input.duration, input.language);
  const prompt = `Write a ${input.duration}-second ${input.platform} script.

INFLUENCER
${personaBlock(inf)}

BRIEF
Topic: ${input.topic}
Category: ${input.category}
Tone: ${input.tone}
Target audience: ${input.targetAudience || 'general Instagram audience in India'}
Call to action to use: ${input.callToAction || 'ask viewers to follow and comment'}

LANGUAGE
${languageRules(input.language)}

STRUCTURE (approximate spoken word counts, total ≈ ${b.total} words):
1. hook (~${b.hook} words): the first 3 seconds; a surprising question, bold claim or pattern-interrupt that stops the scroll.
2. intro (~${b.intro} words): greet as ${inf?.name ?? 'the creator'} and introduce the topic.
3. main (~${b.main} words): explain the topic conversationally with concrete, accurate, useful points.
4. engagement (~${b.engagement} words): ask the audience a specific question to comment on.
5. cta (~${b.cta} words): the call to action (follow / like / comment / save).

Return JSON with title, hook, intro, main, engagement, cta. The title may be in ${langName(input.language)} or English.`;
  const value = await llm.generateJSON<{ title: string } & ScriptSections>({
    system: SCRIPT_SYSTEM,
    prompt,
    schema: SCRIPT_SCHEMA as unknown as Record<string, unknown>,
  });
  const { title, ...sections } = value;
  return { value: { title, sections }, provider: llm.id, isDemo: false };
}

export async function rewriteSection(
  script: Script,
  key: ScriptSectionKey,
  inf: Influencer | null,
  instructions: string,
): Promise<WriterResult<string>> {
  const llm = await resolveLLM();
  if (!llm) {
    const text = templateSection(
      script.language,
      key,
      {
        name: inf?.name ?? 'your creator',
        topic: script.topic,
        audience: script.targetAudience || 'you',
        cta: script.callToAction,
        tone: script.tone,
      },
      script.sections[key],
    );
    return { value: text, provider: TEMPLATE_LLM_ID, isDemo: true };
  }
  const meta = SCRIPT_SECTIONS.find((s) => s.key === key)!;
  const b = wordBudget(script.duration, script.language);
  const full = SCRIPT_SECTIONS.map((s) => `[${s.label}]\n${script.sections[s.key]}`).join('\n\n');
  const prompt = `Here is the current ${script.duration}-second script about "${script.topic}" (tone: ${script.tone}).

${full}

INFLUENCER
${personaBlock(inf)}

Rewrite ONLY the "${meta.label}" section (${meta.hint}), about ${b[key]} spoken words, so it flows naturally with the sections around it and sounds different from the current version.
${instructions ? `Extra instructions from the user: ${instructions}` : ''}
${languageRules(script.language)}
Return JSON {"text": "..."}.`;
  const out = await llm.generateJSON<{ text: string }>({
    system: SCRIPT_SYSTEM,
    prompt,
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    maxTokens: 4000,
  });
  return { value: out.text, provider: llm.id, isDemo: false };
}

// ---------------------------------------------------------------- screenplay

export type SceneDraft = Omit<
  Scene,
  'id' | 'screenplayId' | 'orderIndex' | 'thumbnailImageId' | 'thumbnailUrl' | 'audioId' | 'audioUrl' | 'createdAt' | 'updatedAt'
>;

const SCENE_FIELDS = [
  'duration', 'description', 'action', 'expression', 'bodyLanguage', 'cameraAngle', 'cameraMovement', 'background',
  'dialogue', 'voiceEmotion', 'subtitle', 'visualPrompt', 'transition',
] as const;

const SCENES_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: 'Seconds' },
          description: { type: 'string' },
          action: { type: 'string' },
          expression: { type: 'string' },
          bodyLanguage: { type: 'string' },
          cameraAngle: { type: 'string' },
          cameraMovement: { type: 'string' },
          background: { type: 'string' },
          dialogue: { type: 'string' },
          voiceEmotion: { type: 'string' },
          subtitle: { type: 'string' },
          visualPrompt: { type: 'string' },
          transition: { type: 'string' },
        },
        required: [...SCENE_FIELDS],
        additionalProperties: false,
      },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
} as const;

export function sceneVisualPrompt(inf: Influencer | null, s: Pick<SceneDraft, 'action' | 'expression' | 'cameraAngle' | 'background'>) {
  const base = inf ? [inf.appearancePrompt || inf.appearance, inf.clothingStyle] : [];
  return [
    ...base,
    s.action,
    `${s.expression} facial expression`,
    `${s.cameraAngle.toLowerCase()}`,
    `background: ${s.background}`,
    'vertical 9:16 frame',
    inf ? styleSuffix(inf.characterType, inf.cartoonStyle) : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** Deterministic (non-AI) script → scenes split, used when no LLM is configured. */
function ruleBasedScenes(script: Script, inf: Influencer | null): SceneDraft[] {
  const wps = WORDS_PER_SECOND[script.language];
  const bg = inf?.niches.some((n) => /tech/i.test(n)) ? BACKGROUNDS[4] : BACKGROUNDS[0];
  const style: Record<ScriptSectionKey, { expression: string; camera: string; move: string; action: string; body: string; emotion: string; transition: string }> = {
    hook: { expression: 'Excited', camera: 'Close-up', move: 'Slow push-in', action: 'Leans toward the camera and grabs attention', body: 'Leaning forward, eyebrows raised', emotion: 'Curious and energetic', transition: 'Cut' },
    intro: { expression: 'Friendly', camera: 'Medium close-up', move: 'Static', action: 'Waves and introduces the topic with a warm smile', body: 'Open posture, small wave', emotion: 'Warm and welcoming', transition: 'Cut' },
    main: { expression: 'Confident', camera: 'Medium shot', move: 'Slow push-in', action: 'Explains the point using hand gestures', body: 'Animated hand gestures, relaxed shoulders', emotion: 'Confident and conversational', transition: 'Cut' },
    engagement: { expression: 'Curious', camera: 'Medium close-up', move: 'Static', action: 'Tilts head and asks the audience a question', body: 'Head tilt, pointing at the viewer', emotion: 'Inviting and curious', transition: 'Crossfade' },
    cta: { expression: 'Happy', camera: 'Close-up', move: 'Slow pull-out', action: 'Points to the follow button and smiles', body: 'Pointing gesture, thumbs up', emotion: 'Upbeat and friendly', transition: 'Fade' },
  };
  const out: SceneDraft[] = [];
  for (const { key } of SCRIPT_SECTIONS) {
    const text = script.sections[key].trim();
    if (!text) continue;
    // Split main content into ~8 second chunks by sentence.
    const chunks: string[] = [];
    if (key === 'main') {
      const sentences = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
      let cur = '';
      for (const sen of sentences) {
        if (cur && (cur + ' ' + sen).split(/\s+/).length / wps > 8) {
          chunks.push(cur.trim());
          cur = sen;
        } else cur += ' ' + sen;
      }
      if (cur.trim()) chunks.push(cur.trim());
    } else chunks.push(text);

    chunks.forEach((chunk, i) => {
      const st = style[key];
      const words = chunk.split(/\s+/).length;
      const camera = key === 'main' ? CAMERA_ANGLES[(i % 3) + 2] : st.camera;
      const draft = {
        duration: Math.max(2, Math.round((words / wps) * 10) / 10),
        description: `${SCRIPT_SECTIONS.find((s) => s.key === key)!.label}${chunks.length > 1 ? ` (part ${i + 1})` : ''}`,
        action: st.action,
        expression: st.expression,
        bodyLanguage: st.body,
        cameraAngle: camera,
        cameraMovement: st.move,
        background: bg,
        dialogue: chunk,
        voiceEmotion: st.emotion,
        subtitle: chunk,
        transition: st.transition,
      };
      out.push({ ...draft, visualPrompt: sceneVisualPrompt(inf, draft) });
    });
  }
  return out;
}

export async function writeScreenplay(script: Script, inf: Influencer | null): Promise<WriterResult<SceneDraft[]>> {
  const llm = await resolveLLM();
  if (!llm) return { value: ruleBasedScenes(script, inf), provider: 'rule-based', isDemo: true };
  const full = SCRIPT_SECTIONS.map((s) => `[${s.label}]\n${script.sections[s.key]}`).join('\n\n');
  const prompt = `Convert this ${script.duration}-second vertical-video script into a scene-by-scene screenplay / storyboard.

INFLUENCER
${personaBlock(inf)}
Appearance (keep identical in every scene): ${inf?.appearancePrompt || inf?.appearance || 'n/a'}
Clothing: ${inf?.clothingStyle ?? 'n/a'}
Visual style: ${inf ? styleSuffix(inf.characterType, inf.cartoonStyle) : 'n/a'}

SCRIPT (${langName(script.language)})
${full}

RULES
- Cover every line of the script in order; "dialogue" must be the exact script words for that scene (do not translate or rewrite them).
- 4 to 10 scenes. Scene durations should add up to about ${script.duration} seconds; the first scene is the hook (≈3 s).
- "subtitle" is the on-screen caption: the dialogue, shortened if it is long, in the same language.
- Write description, action, expression, bodyLanguage, cameraAngle, cameraMovement, background, voiceEmotion and transition in English.
- cameraAngle examples: ${CAMERA_ANGLES.join(', ')}. transition examples: Cut, Fade, Crossfade, Zoom, Swipe up.
- "visualPrompt" is a self-contained English image-generation prompt for a 9:16 frame of this scene. It must restate the influencer's fixed appearance and clothing so the character stays consistent, then the action, expression, camera framing, background and visual style.
- ${inf?.characterType === 'cartoon' ? 'This is an original animated character: use animated, expressive acting. Never reference existing copyrighted characters or studios.' : 'This is a photorealistic human: keep acting natural and believable.'}`;
  const out = await llm.generateJSON<{ scenes: SceneDraft[] }>({
    system: 'You are a short-form video director and storyboard artist. You output precise, production-ready scene breakdowns.',
    prompt,
    schema: SCENES_SCHEMA as unknown as Record<string, unknown>,
  });
  return {
    value: out.scenes.map((s) => ({ ...s, duration: Math.max(1, Math.round(Number(s.duration) * 10) / 10 || 3) })),
    provider: llm.id,
    isDemo: false,
  };
}

export async function rewriteScene(
  scene: Scene,
  script: Script | null,
  inf: Influencer | null,
  instructions: string,
): Promise<WriterResult<Partial<SceneDraft>>> {
  const llm = await resolveLLM();
  if (!llm) {
    // Deterministic variation: rotate camera angle and expression; keep the dialogue.
    const angles = CAMERA_ANGLES;
    const next = angles[(angles.indexOf(scene.cameraAngle) + 1) % angles.length];
    const draft = { ...scene, cameraAngle: next };
    return { value: { cameraAngle: next, visualPrompt: sceneVisualPrompt(inf, draft) }, provider: 'rule-based', isDemo: true };
  }
  const prompt = `Re-imagine the direction of this storyboard scene for a vertical influencer video. Keep the dialogue words exactly as they are.

INFLUENCER
${personaBlock(inf)}
Appearance (keep identical): ${inf?.appearancePrompt || inf?.appearance || 'n/a'}

SCRIPT TOPIC: ${script?.topic ?? 'n/a'}
CURRENT SCENE (JSON): ${JSON.stringify(
    Object.fromEntries(SCENE_FIELDS.map((f) => [f, scene[f]])),
  )}
${instructions ? `User instructions: ${instructions}` : 'Make it more visually engaging.'}

Return the full scene JSON with the same fields. Keep "dialogue" identical.`;
  const schema = (SCENES_SCHEMA.properties.scenes.items as unknown) as Record<string, unknown>;
  const out = await llm.generateJSON<SceneDraft>({
    system: 'You are a short-form video director and storyboard artist.',
    prompt,
    schema,
    maxTokens: 4000,
  });
  return { value: { ...out, dialogue: scene.dialogue }, provider: llm.id, isDemo: false };
}

// ---------------------------------------------------------------- social

const SOCIAL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    suggestedPostingTime: { type: 'string' },
  },
  required: ['title', 'caption', 'hashtags', 'description', 'suggestedPostingTime'],
  additionalProperties: false,
} as const;

function demoSocial(script: Script, inf: Influencer | null): Omit<SocialContent, 'provider' | 'isDemo'> {
  const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 30);
  const tags = [
    ...new Set([
      slug(script.topic),
      slug(script.category),
      ...(inf?.niches ?? []).map(slug),
      'reels', 'instagramreels', 'india', script.language === 'hi' ? 'hindi' : script.language === 'mr' ? 'marathi' : 'explore',
    ]),
  ].filter(Boolean);
  return {
    title: script.title,
    caption: `${script.sections.hook}\n\n${script.sections.engagement}`.trim(),
    hashtags: tags.map((t) => `#${t.toLowerCase()}`).slice(0, 12),
    description: `${inf?.name ?? 'Creator'} talks about ${script.topic} in a ${script.tone.toLowerCase()} ${script.duration}s reel.`,
    suggestedPostingTime: 'Weekdays 7:00–9:00 PM IST (typical peak for Indian audiences — verify with your Instagram Insights)',
  };
}

export async function writeSocial(script: Script, inf: Influencer | null): Promise<SocialContent> {
  const llm = await resolveLLM();
  if (!llm) return { ...demoSocial(script, inf), provider: TEMPLATE_LLM_ID, isDemo: true };
  const full = SCRIPT_SECTIONS.map((s) => script.sections[s.key]).join('\n');
  const out = await llm.generateJSON<Omit<SocialContent, 'provider' | 'isDemo'>>({
    system: 'You are an Instagram growth strategist for Indian creators.',
    prompt: `Create Instagram publishing copy for this reel by ${inf?.name ?? 'the creator'} (${inf?.niches.join(', ') ?? script.category}).
Topic: ${script.topic}. Language of the reel: ${langName(script.language)}.
Script:
${full}

- title: a short reel title (max 60 characters)
- caption: an engaging caption (2–4 short lines, may include 1–3 emojis, written in the reel's language, end with a question)
- hashtags: 10–15 relevant hashtags including the # sign, mix of broad and niche, Indian audience
- description: one or two sentence description of the video in English
- suggestedPostingTime: best day/time window in IST for this niche with a one-line reason (note that Insights should be checked)`,
    schema: SOCIAL_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 4000,
  });
  return {
    ...out,
    hashtags: out.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)),
    provider: llm.id,
    isDemo: false,
  };
}
