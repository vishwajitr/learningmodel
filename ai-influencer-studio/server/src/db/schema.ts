// SQLite schema. Every table has an id primary key and timestamps, and
// relationships are explicit foreign keys. The repository layer (repository.ts)
// is the only place that knows about SQL, so a MongoDB adapter can replace it.
export const SCHEMA_VERSION = 1;

export const schemaSql = /* sql */ `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT NOT NULL,
  language TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '',
  pitch REAL NOT NULL DEFAULT 0,
  speed REAL NOT NULL DEFAULT 1,
  emotion TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'natural',
  provider TEXT NOT NULL DEFAULT 'auto',
  provider_voice_id TEXT NOT NULL DEFAULT '',
  reference_audio_url TEXT,
  reference_text TEXT NOT NULL DEFAULT '',
  sample_audio_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS influencers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  character_type TEXT NOT NULL CHECK (character_type IN ('human','cartoon')),
  cartoon_style TEXT,
  gender TEXT NOT NULL,
  age INTEGER NOT NULL,
  ethnicity TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  clothing_style TEXT NOT NULL DEFAULT '',
  languages TEXT NOT NULL DEFAULT '[]',
  primary_language TEXT NOT NULL DEFAULT 'en',
  speaking_style TEXT NOT NULL DEFAULT '',
  voice_profile_id TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL,
  accent TEXT NOT NULL DEFAULT '',
  pitch REAL NOT NULL DEFAULT 0,
  speaking_speed REAL NOT NULL DEFAULT 1,
  background_story TEXT NOT NULL DEFAULT '',
  niches TEXT NOT NULL DEFAULT '[]',
  profile_image_id TEXT,
  master_image_id TEXT,
  appearance_prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  seed INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS influencer_images (
  id TEXT PRIMARY KEY,
  influencer_id TEXT NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL DEFAULT '1:1',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  provider TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'saved',
  seed INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_influencer ON influencer_images(influencer_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  influencer_id TEXT REFERENCES influencers(id) ON DELETE SET NULL,
  script_id TEXT,
  screenplay_id TEXT,
  final_video_id TEXT,
  reel_settings TEXT NOT NULL DEFAULT '{}',
  social TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  influencer_id TEXT REFERENCES influencers(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  topic TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT NOT NULL,
  duration INTEGER NOT NULL,
  tone TEXT NOT NULL,
  target_audience TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'Instagram Reels',
  call_to_action TEXT NOT NULL DEFAULT '',
  sections TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  provider TEXT NOT NULL DEFAULT 'manual',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screenplays (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  influencer_id TEXT REFERENCES influencers(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  provider TEXT NOT NULL DEFAULT 'manual',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  screenplay_id TEXT NOT NULL REFERENCES screenplays(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 4,
  description TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  expression TEXT NOT NULL DEFAULT '',
  body_language TEXT NOT NULL DEFAULT '',
  camera_angle TEXT NOT NULL DEFAULT '',
  camera_movement TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  dialogue TEXT NOT NULL DEFAULT '',
  voice_emotion TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  visual_prompt TEXT NOT NULL DEFAULT '',
  transition TEXT NOT NULL DEFAULT 'Cut',
  thumbnail_image_id TEXT REFERENCES influencer_images(id) ON DELETE SET NULL,
  audio_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenes_screenplay ON scenes(screenplay_id, order_index);

CREATE TABLE IF NOT EXISTS generated_audio (
  id TEXT PRIMARY KEY,
  influencer_id TEXT REFERENCES influencers(id) ON DELETE SET NULL,
  voice_profile_id TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL,
  script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  url TEXT,
  duration_sec REAL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generated_videos (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  url TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  job_id TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_configurations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'auto',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
