import type { AspectRatio, CartoonStyle, CharacterType, ImageKind } from './types.js';

export interface PromptTemplate {
  id: string;
  label: string;
  description: string;
  kind: ImageKind;
  aspectRatio: AspectRatio;
  appliesTo: 'both' | CharacterType;
  prompt: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'ig-profile',
    label: 'Instagram profile picture',
    description: 'Centered head-and-shoulders, clean background',
    kind: 'profile',
    aspectRatio: '1:1',
    appliesTo: 'both',
    prompt: 'head and shoulders portrait, looking at camera, warm genuine smile, centered composition, clean soft gradient background, flattering soft key light',
  },
  {
    id: 'talking-camera',
    label: 'Talking to camera',
    description: 'Vertical framing for talking-head reels',
    kind: 'portrait',
    aspectRatio: '9:16',
    appliesTo: 'both',
    prompt: 'medium close-up, talking directly to the camera, mouth slightly open mid-sentence, expressive eyebrows, vertical smartphone framing, eye level',
  },
  {
    id: 'studio-setup',
    label: 'Studio setup',
    description: 'Creator studio with ring light and mic',
    kind: 'portrait',
    aspectRatio: '9:16',
    appliesTo: 'both',
    prompt: 'sitting in a modern content creator studio, ring light reflection in eyes, podcast microphone, neon accent lights in purple and blue, shallow depth of field',
  },
  {
    id: 'outdoor-vlog',
    label: 'Outdoor vlog',
    description: 'Handheld selfie-vlog outdoors',
    kind: 'pose',
    aspectRatio: '9:16',
    appliesTo: 'both',
    prompt: 'outdoor vlog, holding camera at arm length selfie angle, busy Indian city street market in background, golden hour sunlight, candid energetic mood',
  },
  {
    id: 'fashion-shoot',
    label: 'Fashion photoshoot',
    description: 'Editorial full-body fashion look',
    kind: 'full_body',
    aspectRatio: '3:4',
    appliesTo: 'both',
    prompt: 'full body fashion editorial photoshoot, confident pose, stylish outfit, studio backdrop, dramatic rim lighting, magazine quality',
  },
  {
    id: 'sitting-explaining',
    label: 'Sitting and explaining',
    description: 'Seated, explaining with hand gestures',
    kind: 'pose',
    aspectRatio: '9:16',
    appliesTo: 'both',
    prompt: 'sitting on a chair, explaining something with open hand gestures, engaged friendly expression, cozy home office background, medium shot',
  },
  {
    id: 'walking-talking',
    label: 'Walking and talking',
    description: 'Walk-and-talk tracking shot',
    kind: 'full_body',
    aspectRatio: '9:16',
    appliesTo: 'both',
    prompt: 'walking towards the camera while talking, tracking shot, park pathway with trees, natural motion, mid-stride, casual and lively',
  },
  {
    id: 'cartoon-expressions',
    label: 'Cartoon expressions',
    description: 'Expression sheet for animated characters',
    kind: 'expression',
    aspectRatio: '16:9',
    appliesTo: 'cartoon',
    prompt: 'character expression sheet, six facial expressions in a row: happy, surprised, laughing, thinking, excited, wink, consistent character design, plain light background',
  },
];

export const POSE_PRESETS = [
  'standing with arms crossed, confident', 'waving hello at the camera', 'pointing at text on screen to the side',
  'hands on hips, playful', 'holding a smartphone and showing the screen', 'sitting cross-legged on a sofa',
  'leaning on a desk, relaxed', 'thumbs up, cheerful',
];
export const EXPRESSION_PRESETS = [
  'big happy smile', 'surprised with raised eyebrows', 'thoughtful, finger on chin', 'laughing joyfully',
  'confident smirk', 'curious head tilt', 'excited, eyes wide', 'empathetic soft smile',
];
export const OUTFIT_PRESETS = [
  'casual white t-shirt and denim jacket', 'elegant saree with modern blouse', 'kurti with jeans and jhumkas',
  'smart blazer over a black top', 'athleisure hoodie and joggers', 'indo-western fusion dress',
  'festive lehenga', 'summer floral dress',
];

export function styleSuffix(type: CharacterType, cartoonStyle: CartoonStyle | null): string {
  if (type === 'human') {
    return 'photorealistic, natural skin texture with pores, realistic facial details, soft cinematic lighting, 85mm lens, sharp focus, high detail';
  }
  switch (cartoonStyle) {
    case '2d':
      return '2D cartoon illustration, clean line art, flat vibrant colors, expressive features, original character design';
    case 'anime':
      return 'anime style, cel shading, expressive large eyes, vibrant colors, original character design';
    case 'illustration':
      return 'custom digital illustration, painterly shading, stylized proportions, original character design';
    case 'stylized_3d':
      return 'stylized 3D animated feature-film look, soft subsurface skin shading, big expressive eyes, warm global illumination, original character design, not based on any existing character';
    case '3d':
    default:
      return '3D animated character render, stylized proportions, soft global illumination, vibrant colors, original character design';
  }
}

export function defaultNegativePrompt(type: CharacterType): string {
  return type === 'human'
    ? 'cartoon, illustration, 3d render, plastic skin, deformed, extra fingers, bad hands, blurry, watermark, text, logo'
    : 'photorealistic, photograph, deformed, extra limbs, blurry, watermark, text, logo, copyrighted character, celebrity likeness';
}
