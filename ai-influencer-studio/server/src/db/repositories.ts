import type {
  Activity, GeneratedAudio, GeneratedVideo, Influencer, InfluencerImage, Job, ModelConfiguration,
  Project, Scene, Screenplay, Script, VoiceProfile,
} from '../../../shared/types.js';
import { SqliteRepository, type Repository } from './repository.js';

// Scene rows don't persist the resolved URLs; those are added by the API layer.
export type SceneRecord = Omit<Scene, 'thumbnailUrl' | 'audioUrl'>;

export const repos: {
  influencers: Repository<Influencer>;
  voices: Repository<VoiceProfile>;
  images: Repository<InfluencerImage & { updatedAt?: string }>;
  scripts: Repository<Script>;
  screenplays: Repository<Screenplay>;
  scenes: Repository<SceneRecord>;
  projects: Repository<Project>;
  audio: Repository<GeneratedAudio>;
  videos: Repository<GeneratedVideo>;
  modelConfigs: Repository<ModelConfiguration>;
  jobs: Repository<Job>;
  activities: Repository<Activity & { updatedAt?: string }>;
} = {
  influencers: new SqliteRepository<Influencer>({
    table: 'influencers',
    fields: {
      name: 'text', characterType: 'text', cartoonStyle: 'text', gender: 'text', age: 'int', ethnicity: 'text',
      personality: 'text', appearance: 'text', clothingStyle: 'text', languages: 'json', primaryLanguage: 'text',
      speakingStyle: 'text', voiceProfileId: 'text', accent: 'text', pitch: 'real', speakingSpeed: 'real',
      backgroundStory: 'text', niches: 'json', profileImageId: 'text', masterImageId: 'text',
      appearancePrompt: 'text', negativePrompt: 'text', seed: 'int', isDefault: 'bool',
    },
  }),
  voices: new SqliteRepository<VoiceProfile>({
    table: 'voice_profiles',
    fields: {
      name: 'text', gender: 'text', language: 'text', accent: 'text', pitch: 'real', speed: 'real', emotion: 'text',
      style: 'text', provider: 'text', providerVoiceId: 'text', referenceAudioUrl: 'text', referenceText: 'text',
      sampleAudioUrl: 'text', description: 'text',
    },
  }),
  images: new SqliteRepository<InfluencerImage & { updatedAt?: string }>({
    table: 'influencer_images',
    fields: {
      influencerId: 'text', url: 'text', kind: 'text', prompt: 'text', negativePrompt: 'text', aspectRatio: 'text',
      width: 'int', height: 'int', provider: 'text', isDemo: 'bool', status: 'text', seed: 'int',
    },
  }),
  scripts: new SqliteRepository<Script>({
    table: 'scripts',
    fields: {
      title: 'text', influencerId: 'text', projectId: 'text', topic: 'text', category: 'text', language: 'text',
      duration: 'int', tone: 'text', targetAudience: 'text', platform: 'text', callToAction: 'text',
      sections: 'json', status: 'text', provider: 'text', isDemo: 'bool',
    },
  }),
  screenplays: new SqliteRepository<Screenplay>({
    table: 'screenplays',
    fields: {
      title: 'text', scriptId: 'text', influencerId: 'text', projectId: 'text', status: 'text', provider: 'text',
      isDemo: 'bool',
    },
  }),
  scenes: new SqliteRepository<SceneRecord>({
    table: 'scenes',
    defaultOrder: 'orderIndex',
    fields: {
      screenplayId: 'text', orderIndex: 'int', duration: 'real', description: 'text', action: 'text',
      expression: 'text', bodyLanguage: 'text', cameraAngle: 'text', cameraMovement: 'text', background: 'text',
      dialogue: 'text', voiceEmotion: 'text', subtitle: 'text', visualPrompt: 'text', transition: 'text',
      thumbnailImageId: 'text', audioId: 'text',
    },
  }),
  projects: new SqliteRepository<Project>({
    table: 'projects',
    fields: {
      name: 'text', description: 'text', status: 'text', influencerId: 'text', scriptId: 'text',
      screenplayId: 'text', finalVideoId: 'text', reelSettings: 'json', social: 'json',
    },
  }),
  audio: new SqliteRepository<GeneratedAudio>({
    table: 'generated_audio',
    fields: {
      influencerId: 'text', voiceProfileId: 'text', scriptId: 'text', sceneId: 'text', projectId: 'text',
      text: 'text', url: 'text', durationSec: 'real', provider: 'text', status: 'text', error: 'text', jobId: 'text',
    },
  }),
  videos: new SqliteRepository<GeneratedVideo>({
    table: 'generated_videos',
    fields: {
      projectId: 'text', sceneId: 'text', kind: 'text', url: 'text', provider: 'text', status: 'text',
      progress: 'real', error: 'text', jobId: 'text', isDemo: 'bool', notes: 'text',
    },
  }),
  modelConfigs: new SqliteRepository<ModelConfiguration>({
    table: 'model_configurations',
    fields: { kind: 'text', provider: 'text', settings: 'json' },
  }),
  jobs: new SqliteRepository<Job>({
    table: 'jobs',
    fields: {
      type: 'text', status: 'text', progress: 'real', message: 'text', payload: 'json', result: 'json',
      error: 'text', attempts: 'int', maxAttempts: 'int',
    },
  }),
  activities: new SqliteRepository<Activity & { updatedAt?: string }>({
    table: 'activities',
    fields: { type: 'text', entityType: 'text', entityId: 'text', message: 'text' },
  }),
};

export async function logActivity(type: string, entityType: string, entityId: string | null, message: string) {
  await repos.activities.create({ type, entityType, entityId, message });
}
