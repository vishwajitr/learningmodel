import { defaultNegativePrompt } from '../../../shared/promptTemplates.js';
import { DEFAULT_REEL_SETTINGS, type Influencer, type ScriptSections } from '../../../shared/types.js';
import { placeholderPng } from '../lib/placeholder.js';
import { saveMedia } from '../lib/media.js';
import { sceneVisualPrompt, type SceneDraft } from '../services/writers.js';
import { logActivity, repos } from './repositories.js';
import { db } from './sqlite.js';

const SEED_KEY = 'seeded_v1';

export async function seedIfEmpty() {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(SEED_KEY);
  if (done) return false;
  await seed();
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(SEED_KEY, new Date().toISOString());
  return true;
}

async function placeholderImage(inf: Influencer, palette: Parameters<typeof placeholderPng>[0]['palette']) {
  const png = await placeholderPng({
    seedKey: inf.id,
    characterType: inf.characterType,
    width: 1024,
    height: 1024,
    title: inf.name,
    subtitle: inf.characterType === 'human' ? 'Realistic human · replace me' : 'Cartoon 3D · replace me',
    palette,
  });
  const saved = saveMedia('images', 'png', png);
  return repos.images.create({
    influencerId: inf.id,
    url: saved.url,
    kind: 'profile',
    prompt: 'Placeholder profile picture (procedurally drawn, not AI generated). Replace it in the Image Studio or by uploading a photo.',
    negativePrompt: '',
    aspectRatio: '1:1',
    width: 1024,
    height: 1024,
    provider: 'placeholder',
    isDemo: true,
    status: 'saved',
    seed: null,

  });
}

async function seed() {
  // ---------------------------------------------------------------- voices
  const aanyaVoice = await repos.voices.create({
    name: 'Aanya – Natural (Hindi)',
    gender: 'female',
    language: 'hi',
    accent: 'Neutral Indian (Mumbai)',
    pitch: 0,
    speed: 1,
    emotion: 'Warm and friendly',
    style: 'natural',
    provider: 'auto',
    providerVoiceId: '',
    referenceAudioUrl: null,
    referenceText: '',
    sampleAudioUrl: null,
    description: 'Natural conversational human voice for Aanya. Upload a reference clip to clone a specific voice with IndicF5.',
  });
  const aanyaVoiceEn = await repos.voices.create({
    name: 'Aanya – Natural (English)',
    gender: 'female',
    language: 'en',
    accent: 'Indian English',
    pitch: 0,
    speed: 1.05,
    emotion: 'Friendly',
    style: 'friendly',
    provider: 'auto',
    providerVoiceId: '',
    referenceAudioUrl: null,
    referenceText: '',
    sampleAudioUrl: null,
    description: 'Indian-English variant of Aanya’s voice.',
  });
  const taraVoice = await repos.voices.create({
    name: 'Tara – Cartoon Expressive (Hindi)',
    gender: 'female',
    language: 'hi',
    accent: 'Playful Indian',
    pitch: 4,
    speed: 1.12,
    emotion: 'Bubbly and energetic',
    style: 'cartoon_expressive',
    provider: 'auto',
    providerVoiceId: '',
    referenceAudioUrl: null,
    referenceText: '',
    sampleAudioUrl: null,
    description: 'Higher, bouncier animated-character voice for Tara.',
  });
  await repos.voices.create({
    name: 'Tara – Cartoon Expressive (Marathi)',
    gender: 'female',
    language: 'mr',
    accent: 'Puneri Marathi',
    pitch: 4,
    speed: 1.1,
    emotion: 'Cheerful',
    style: 'cartoon_expressive',
    provider: 'auto',
    providerVoiceId: '',
    referenceAudioUrl: null,
    referenceText: '',
    sampleAudioUrl: null,
    description: 'Marathi variant of Tara’s animated voice.',
  });
  void aanyaVoiceEn;

  // ---------------------------------------------------------------- influencers
  const aanya = await repos.influencers.create({
    name: 'Aanya',
    characterType: 'human',
    cartoonStyle: null,
    gender: 'female',
    age: 25,
    ethnicity: 'Indian',
    personality: 'Friendly, curious and relatable. Explains tech like a helpful best friend, with light humour and genuine enthusiasm.',
    appearance: 'Warm medium-brown skin, long wavy dark-brown hair usually worn open, expressive dark-brown eyes, soft natural makeup, small gold stud earrings, a small bindi on occasion.',
    clothingStyle: 'modern casual Indian street style – oversized pastel shirts, denim, kurtis with sneakers',
    languages: ['hi', 'en', 'mr'],
    primaryLanguage: 'hi',
    speakingStyle: 'Conversational Hinglish, warm, quick-paced, uses “dekho”, “sach mein?” and direct questions to the viewer',
    voiceProfileId: aanyaVoice.id,
    accent: 'Neutral Indian (Mumbai)',
    pitch: 0,
    speakingSpeed: 1,
    backgroundStory: 'Grew up in Pune, studied computer engineering, worked at a Bengaluru startup and now makes short videos that help people use technology to make everyday life easier.',
    niches: ['Lifestyle', 'Technology'],
    profileImageId: null,
    masterImageId: null,
    appearancePrompt:
      '25-year-old Indian woman, warm medium-brown skin, long wavy dark-brown hair, expressive dark-brown eyes, soft natural makeup, small gold stud earrings, friendly approachable face',
    negativePrompt: defaultNegativePrompt('human'),
    seed: 424242,
    isDefault: true,
  });
  const tara = await repos.influencers.create({
    name: 'Tara',
    characterType: 'cartoon',
    cartoonStyle: 'stylized_3d',
    gender: 'female',
    age: 24,
    ethnicity: 'Indian',
    personality: 'Bubbly, energetic and funny. Big reactions, loves dance trends, food and pop culture, always hyping up her audience.',
    appearance: 'Original stylized 3D animated Indian woman with big expressive brown eyes, rounded friendly face, long black hair in a high ponytail with a purple scrunchie, warm brown skin, rosy cheeks.',
    clothingStyle: 'colourful kurta-top with denim jacket, chunky sneakers and jhumka earrings',
    languages: ['hi', 'en', 'mr'],
    primaryLanguage: 'hi',
    speakingStyle: 'Fast, expressive and playful with exaggerated reactions, catchphrase “Chalo, shuru karte hain!”',
    voiceProfileId: taraVoice.id,
    accent: 'Playful Indian',
    pitch: 4,
    speakingSpeed: 1.12,
    backgroundStory: 'An original animated creator from a colourful Mumbai neighbourhood who reviews food, trends and entertainment with infectious energy.',
    niches: ['Lifestyle', 'Entertainment'],
    profileImageId: null,
    masterImageId: null,
    appearancePrompt:
      'original stylized 3D animated Indian woman character, age 24, big expressive brown eyes, rounded friendly face, warm brown skin, rosy cheeks, long black hair in a high ponytail with a purple scrunchie',
    negativePrompt: defaultNegativePrompt('cartoon'),
    seed: 777001,
    isDefault: true,
  });

  for (const [inf, palette] of [
    [aanya, { skin: '#b97a56', hair: '#2b1a14', outfit: '#a78bfa', bgFrom: '#1e1b4b', bgTo: '#4c1d95' }],
    [tara, { skin: '#c68863', hair: '#121010', outfit: '#ec4899', bgFrom: '#172554', bgTo: '#6d28d9' }],
  ] as const) {
    const img = await placeholderImage(inf, palette);
    await repos.influencers.update(inf.id, { profileImageId: img.id, masterImageId: img.id });
    await logActivity('influencer.created', 'influencer', inf.id, `Default influencer ${inf.name} installed`);
  }

  // ---------------------------------------------------------------- sample project
  const project = await repos.projects.create({
    name: 'Sample: 3 AI apps that save time',
    description: 'Example reel project with Aanya. Explore the script, storyboard and render workflow.',
    status: 'in_progress',
    influencerId: aanya.id,
    scriptId: null,
    screenplayId: null,
    finalVideoId: null,
    reelSettings: { ...DEFAULT_REEL_SETTINGS, watermarkText: '@aanya.ai', outroText: 'Follow @aanya.ai for more' },
    social: null,
  });

  const sections: ScriptSections = {
    hook: 'क्या आपको पता है कि AI आपकी ज़िंदगी कैसे बदल सकता है?',
    intro: 'हाय दोस्तों, मैं हूँ आन्या! आज मैं आपको तीन ऐसे AI tools बताऊँगी जो रोज़ आपका एक घंटा बचा सकते हैं।',
    main:
      'पहला — AI chat assistant. ईमेल, मैसेज या presentation का draft दो मिनट में तैयार। ' +
      'दूसरा — AI notes app. मीटिंग रिकॉर्ड करो, और summary अपने आप बन जाती है। ' +
      'तीसरा — AI photo editor. बैकग्राउंड हटाना हो या फ़ोटो साफ़ करनी हो, बस एक टैप।',
    engagement: 'अब आप बताओ — आप सबसे ज़्यादा कौन सा AI tool use करते हो? कमेंट में लिखो!',
    cta: 'ऐसे ही tech tips के लिए फ़ॉलो करो, और इस रील को सेव कर लो!',
  };
  const script = await repos.scripts.create({
    title: '3 AI apps जो रोज़ 1 घंटा बचाएँ',
    influencerId: aanya.id,
    projectId: project.id,
    topic: '3 AI apps that save one hour every day',
    category: 'Technology',
    language: 'hi',
    duration: 30,
    tone: 'Friendly',
    targetAudience: 'College students and young professionals in India',
    platform: 'Instagram Reels',
    callToAction: 'Follow for more tech tips',
    sections,
    status: 'draft',
    provider: 'sample',
    isDemo: true,
  });

  const screenplay = await repos.screenplays.create({
    title: '3 AI apps – Storyboard',
    scriptId: script.id,
    influencerId: aanya.id,
    projectId: project.id,
    status: 'draft',
    provider: 'sample',
    isDemo: true,
  });

  const scenes: Omit<SceneDraft, 'visualPrompt'>[] = [
    {
      duration: 4, description: 'Hook – pattern interrupt', action: 'Influencer looks directly at the camera and smiles', expression: 'Excited',
      bodyLanguage: 'Leaning slightly forward, eyebrows raised', cameraAngle: 'Medium close-up', cameraMovement: 'Slow push-in',
      background: 'Tech desk setup with RGB lights', dialogue: sections.hook, voiceEmotion: 'Curious and energetic', subtitle: sections.hook, transition: 'Cut',
    },
    {
      duration: 6, description: 'Introduction', action: 'Waves at the camera and introduces herself', expression: 'Friendly',
      bodyLanguage: 'Open posture, small wave, relaxed shoulders', cameraAngle: 'Medium shot', cameraMovement: 'Static',
      background: 'Tech desk setup with RGB lights', dialogue: sections.intro, voiceEmotion: 'Warm and welcoming', subtitle: sections.intro, transition: 'Cut',
    },
    {
      duration: 8, description: 'Main content – tools 1 and 2', action: 'Explains the topic using hand gestures, counting on fingers', expression: 'Confident and friendly',
      bodyLanguage: 'Animated hand gestures, counting one-two', cameraAngle: 'Medium shot', cameraMovement: 'Slow push-in',
      background: 'Tech desk setup with RGB lights', dialogue: sections.main.split('तीसरा')[0].trim(), voiceEmotion: 'Confident and conversational',
      subtitle: 'AI chat assistant + AI notes app', transition: 'Swipe left',
    },
    {
      duration: 5, description: 'Main content – tool 3', action: 'Holds up a phone and shows the screen to the camera', expression: 'Happy',
      bodyLanguage: 'Holding phone toward lens, nodding', cameraAngle: 'Close-up', cameraMovement: 'Static',
      background: 'Tech desk setup with RGB lights', dialogue: 'तीसरा' + sections.main.split('तीसरा')[1], voiceEmotion: 'Impressed and upbeat',
      subtitle: 'AI photo editor – बस एक टैप!', transition: 'Cut',
    },
    {
      duration: 4, description: 'Engagement question', action: 'Tilts head and points at the viewer', expression: 'Curious',
      bodyLanguage: 'Head tilt, pointing at camera', cameraAngle: 'Medium close-up', cameraMovement: 'Static',
      background: 'Tech desk setup with RGB lights', dialogue: sections.engagement, voiceEmotion: 'Inviting', subtitle: sections.engagement, transition: 'Crossfade',
    },
    {
      duration: 3, description: 'Call to action', action: 'Points up toward the follow button and smiles', expression: 'Happy',
      bodyLanguage: 'Pointing up, thumbs up', cameraAngle: 'Close-up', cameraMovement: 'Slow pull-out',
      background: 'Tech desk setup with RGB lights', dialogue: sections.cta, voiceEmotion: 'Upbeat and friendly', subtitle: sections.cta, transition: 'Fade',
    },
  ];
  for (const [i, s] of scenes.entries()) {
    await repos.scenes.create({
      ...s,
      visualPrompt: sceneVisualPrompt((await repos.influencers.get(aanya.id))!, s),
      screenplayId: screenplay.id,
      orderIndex: i,
      thumbnailImageId: null,
      audioId: null,
    });
  }
  await repos.projects.update(project.id, { scriptId: script.id, screenplayId: screenplay.id });
  await logActivity('project.created', 'project', project.id, 'Sample project "3 AI apps that save time" installed');
}
