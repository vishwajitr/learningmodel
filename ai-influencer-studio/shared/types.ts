// Shared domain types used by both the API server and the React client.
// Keep this file free of runtime dependencies.

export type CharacterType = 'human' | 'cartoon';
export type CartoonStyle = '2d' | '3d' | 'anime' | 'stylized_3d' | 'illustration';
export type Gender = 'female' | 'male' | 'non_binary' | 'other';
export type Language = 'hi' | 'en' | 'mr';

export const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'en', label: 'English', native: 'English' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
];

export const CARTOON_STYLES: { value: CartoonStyle; label: string }[] = [
  { value: '2d', label: '2D cartoon' },
  { value: '3d', label: '3D animated' },
  { value: 'anime', label: 'Anime' },
  { value: 'stylized_3d', label: 'Stylized 3D (original, feature-animation look)' },
  { value: 'illustration', label: 'Custom illustration' },
];

export const CONTENT_CATEGORIES = [
  'Educational', 'Entertainment', 'Lifestyle', 'Technology', 'Finance', 'Fashion',
  'Travel', 'Food', 'Motivation', 'Storytelling', 'Product Review',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const VIDEO_DURATIONS = [15, 30, 45, 60, 90] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];

export const TONES = [
  'Friendly', 'Professional', 'Funny', 'Emotional', 'Energetic', 'Conversational', 'Storytelling',
] as const;
export type Tone = (typeof TONES)[number];

export const PLATFORMS = ['Instagram Reels', 'YouTube Shorts', 'Facebook Reels', 'TikTok-style short video'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const VOICE_STYLES = [
  { value: 'natural', label: 'Natural conversation' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'storytelling', label: 'Storytelling' },
  { value: 'cartoon_expressive', label: 'Cartoon expressive voice' },
] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number]['value'];

export const ASPECT_RATIOS = {
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 768, height: 1365 },
  '16:9': { width: 1365, height: 768 },
  '3:4': { width: 896, height: 1195 },
} as const;
export type AspectRatio = keyof typeof ASPECT_RATIOS;

export type ImageKind =
  | 'profile' | 'portrait' | 'full_body' | 'pose' | 'expression' | 'outfit' | 'scene' | 'upload' | 'reference';

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface Influencer extends Timestamps {
  id: string;
  name: string;
  characterType: CharacterType;
  cartoonStyle: CartoonStyle | null;
  gender: Gender;
  age: number;
  ethnicity: string;
  personality: string;
  appearance: string;
  clothingStyle: string;
  languages: Language[];
  primaryLanguage: Language;
  speakingStyle: string;
  voiceProfileId: string | null;
  accent: string;
  /** Semitone offset, -12..12 */
  pitch: number;
  /** Speed multiplier, 0.5..2.0 */
  speakingSpeed: number;
  backgroundStory: string;
  niches: string[];
  profileImageId: string | null;
  /** Master reference image used for character consistency */
  masterImageId: string | null;
  /** Canonical appearance prompt prepended to every image generation */
  appearancePrompt: string;
  negativePrompt: string;
  /** Fixed seed for consistent generations (null = random) */
  seed: number | null;
  isDefault: boolean;
}

/** Influencer as returned by the API, with resolved media URLs. */
export interface InfluencerView extends Influencer {
  profileImageUrl: string | null;
  masterImageUrl: string | null;
  imageCount: number;
  scriptCount: number;
}

export interface VoiceProfile extends Timestamps {
  id: string;
  name: string;
  gender: Gender;
  language: Language;
  accent: string;
  pitch: number;
  speed: number;
  emotion: string;
  style: VoiceStyle;
  /** TTS provider id, e.g. "mms", "indicf5", "espeak" */
  provider: string;
  /** Provider-specific voice/speaker id */
  providerVoiceId: string;
  /** Reference audio (for voice-cloning engines like IndicF5) */
  referenceAudioUrl: string | null;
  referenceText: string;
  sampleAudioUrl: string | null;
  description: string;
}

export interface InfluencerImage {
  id: string;
  influencerId: string;
  url: string;
  kind: ImageKind;
  prompt: string;
  negativePrompt: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  provider: string;
  /** True when the image is a placeholder and was NOT produced by an AI model */
  isDemo: boolean;
  status: 'preview' | 'saved';
  seed: number | null;
  createdAt: string;
}

export interface ScriptSections {
  hook: string;
  intro: string;
  main: string;
  engagement: string;
  cta: string;
}
export type ScriptSectionKey = keyof ScriptSections;
export const SCRIPT_SECTIONS: { key: ScriptSectionKey; label: string; hint: string }[] = [
  { key: 'hook', label: 'Hook', hint: 'First 3 seconds – grab attention' },
  { key: 'intro', label: 'Introduction', hint: 'Introduce the topic' },
  { key: 'main', label: 'Main Content', hint: 'Explain conversationally' },
  { key: 'engagement', label: 'Engagement', hint: 'Ask the audience a question' },
  { key: 'cta', label: 'Call to Action', hint: 'Follow, like or comment' },
];

export interface GenerationMeta {
  /** Provider that produced the content, e.g. "anthropic", "ollama", "template-demo" */
  provider: string;
  /** True when content came from templates/rules rather than an AI model */
  isDemo: boolean;
}

export interface Script extends Timestamps, GenerationMeta {
  id: string;
  title: string;
  influencerId: string | null;
  projectId: string | null;
  topic: string;
  category: ContentCategory;
  language: Language;
  duration: VideoDuration;
  tone: Tone;
  targetAudience: string;
  platform: Platform;
  callToAction: string;
  sections: ScriptSections;
  status: 'draft' | 'final';
}

export interface Scene {
  id: string;
  screenplayId: string;
  orderIndex: number;
  duration: number;
  description: string;
  action: string;
  expression: string;
  bodyLanguage: string;
  cameraAngle: string;
  cameraMovement: string;
  background: string;
  dialogue: string;
  voiceEmotion: string;
  subtitle: string;
  visualPrompt: string;
  transition: string;
  thumbnailImageId: string | null;
  thumbnailUrl: string | null;
  audioId: string | null;
  audioUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Screenplay extends Timestamps, GenerationMeta {
  id: string;
  title: string;
  scriptId: string | null;
  influencerId: string | null;
  projectId: string | null;
  status: 'draft' | 'final';
}

export interface ScreenplayView extends Screenplay {
  scenes: Scene[];
  totalDuration: number;
}

export const CAMERA_ANGLES = [
  'Extreme close-up', 'Close-up', 'Medium close-up', 'Medium shot', 'Medium wide shot',
  'Wide shot', 'Over-the-shoulder', 'Low angle', 'High angle', 'POV',
];
export const CAMERA_MOVEMENTS = [
  'Static', 'Slow push-in', 'Slow pull-out', 'Pan left', 'Pan right', 'Tilt up', 'Tilt down',
  'Handheld', 'Tracking shot', 'Orbit',
];
export const EXPRESSIONS = [
  'Excited', 'Curious', 'Confident', 'Friendly', 'Thoughtful', 'Surprised', 'Happy', 'Serious',
  'Playful', 'Empathetic', 'Determined', 'Laughing',
];
export const TRANSITIONS = ['Cut', 'Fade', 'Crossfade', 'Zoom', 'Swipe left', 'Swipe up', 'Whip pan', 'Glitch'];
export const BACKGROUNDS = [
  'Cozy home studio with soft lighting', 'Modern minimalist room', 'Outdoor city street',
  'Cafe with warm bokeh lights', 'Tech desk setup with RGB lights', 'Park with greenery',
  'Professional studio backdrop', 'Rooftop at golden hour', 'Kitchen', 'Office workspace',
];

export interface ReelSettings {
  aspectRatio: '9:16';
  width: number;
  height: number;
  fps: number;
  format: 'mp4';
  subtitles: boolean;
  burnSubtitles: boolean;
  backgroundMusicUrl: string | null;
  musicVolume: number;
  watermarkText: string;
  introText: string;
  outroText: string;
}

export const DEFAULT_REEL_SETTINGS: ReelSettings = {
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  fps: 30,
  format: 'mp4',
  subtitles: true,
  burnSubtitles: true,
  backgroundMusicUrl: null,
  musicVolume: 0.15,
  watermarkText: '',
  introText: '',
  outroText: '',
};

export interface SocialContent extends GenerationMeta {
  title: string;
  caption: string;
  hashtags: string[];
  description: string;
  suggestedPostingTime: string;
}

export type ProjectStatus = 'draft' | 'in_progress' | 'rendering' | 'completed';

export interface Project extends Timestamps {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  influencerId: string | null;
  scriptId: string | null;
  screenplayId: string | null;
  finalVideoId: string | null;
  reelSettings: ReelSettings;
  social: SocialContent | null;
}

export interface ProjectView extends Project {
  influencer: InfluencerView | null;
  script: Script | null;
  screenplay: ScreenplayView | null;
  audio: GeneratedAudio[];
  videos: GeneratedVideo[];
  finalVideo: GeneratedVideo | null;
  sceneImageCount: number;
}

export type MediaStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GeneratedAudio extends Timestamps {
  id: string;
  influencerId: string | null;
  voiceProfileId: string | null;
  scriptId: string | null;
  sceneId: string | null;
  projectId: string | null;
  text: string;
  url: string | null;
  durationSec: number | null;
  provider: string;
  status: MediaStatus;
  error: string | null;
  jobId: string | null;
}

export interface GeneratedVideo extends Timestamps {
  id: string;
  projectId: string | null;
  sceneId: string | null;
  kind: 'scene' | 'final' | 'animatic';
  url: string | null;
  provider: string;
  status: MediaStatus;
  progress: number;
  error: string | null;
  jobId: string | null;
  /** True when no AI animation / lip sync was used (e.g. FFmpeg slideshow animatic) */
  isDemo: boolean;
  notes: string;
}

export type ProviderKind = 'llm' | 'image' | 'tts' | 'animation' | 'video';

export interface ModelConfiguration extends Timestamps {
  id: string;
  kind: ProviderKind;
  /** Selected provider id, or "auto" */
  provider: string;
  settings: Record<string, string | number | boolean>;
}

export type ProviderState = 'ready' | 'demo' | 'not_configured' | 'not_installed' | 'unreachable' | 'error';

export interface ProviderStatus {
  id: string;
  name: string;
  kind: ProviderKind;
  state: ProviderState;
  isDemo: boolean;
  message: string;
  setupInstructions: string[];
  details?: Record<string, unknown>;
}

export interface SystemStatus {
  providers: ProviderStatus[];
  active: Record<ProviderKind, string | null>;
  configurations: ModelConfiguration[];
  gpu: { available: boolean; source: string; devices: string[]; message: string };
  ffmpeg: { available: boolean; version: string | null };
  aiService: { url: string; reachable: boolean; message: string };
}

export type JobType = 'image.generate' | 'tts.generate' | 'scene.images' | 'video.animate' | 'video.render';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job extends Timestamps {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
}

export interface Activity {
  id: string;
  type: string;
  entityType: string;
  entityId: string | null;
  message: string;
  createdAt: string;
}

export interface DashboardStats {
  totals: {
    influencers: number;
    scripts: number;
    screenplays: number;
    videos: number;
    draftProjects: number;
    projects: number;
  };
  recentInfluencers: InfluencerView[];
  recentActivities: Activity[];
  recentProjects: Project[];
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
  setupInstructions?: string[];
}
