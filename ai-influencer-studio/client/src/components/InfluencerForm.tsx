import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bot, User } from 'lucide-react';
import { CARTOON_STYLES, LANGUAGES, type InfluencerView, type Language } from '@shared/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Slider } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { qk, useApiMutation, useVoices } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  characterType: z.enum(['human', 'cartoon']),
  cartoonStyle: z.enum(['2d', '3d', 'anime', 'stylized_3d', 'illustration']).nullable(),
  gender: z.enum(['female', 'male', 'non_binary', 'other']),
  age: z.coerce.number().int('Whole number').min(1, 'Too young').max(120, 'Too old'),
  ethnicity: z.string().max(80),
  personality: z.string().min(3, 'Describe the personality').max(1000),
  appearance: z.string().min(3, 'Describe the appearance').max(2000),
  clothingStyle: z.string().max(500),
  languages: z.array(z.enum(['hi', 'en', 'mr'])).min(1, 'Pick at least one language'),
  primaryLanguage: z.enum(['hi', 'en', 'mr']),
  speakingStyle: z.string().max(500),
  voiceProfileId: z.string().nullable(),
  accent: z.string().max(100),
  pitch: z.number().min(-12).max(12),
  speakingSpeed: z.number().min(0.5).max(2),
  backgroundStory: z.string().max(4000),
  nichesText: z.string().max(400),
  appearancePrompt: z.string().max(2000),
  negativePrompt: z.string().max(1000),
  seedText: z.string().regex(/^\d*$/, 'Digits only'),
});
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  name: '', characterType: 'human', cartoonStyle: null, gender: 'female', age: 25, ethnicity: 'Indian', personality: '', appearance: '',
  clothingStyle: '', languages: ['hi', 'en'], primaryLanguage: 'hi', speakingStyle: '', voiceProfileId: null, accent: '', pitch: 0,
  speakingSpeed: 1, backgroundStory: '', nichesText: '', appearancePrompt: '', negativePrompt: '', seedText: '',
};

function toForm(inf: InfluencerView): FormValues {
  return { ...inf, nichesText: inf.niches.join(', '), seedText: inf.seed === null ? '' : String(inf.seed) };
}

export function InfluencerFormDialog({
  open, onOpenChange, influencer, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; influencer?: InfluencerView | null; onSaved?: (inf: InfluencerView) => void }) {
  const { data: voices } = useVoices();
  const form = useForm<FormValues>({ resolver: zodResolver(schema) as never, defaultValues: EMPTY });
  const { register, handleSubmit, watch, control, reset, setValue, formState: { errors } } = form;

  useEffect(() => {
    if (open) reset(influencer ? toForm(influencer) : EMPTY);
  }, [open, influencer, reset]);

  const save = useApiMutation(
    (values: FormValues) => {
      const { nichesText, seedText, ...rest } = values;
      const body = {
        ...rest,
        niches: nichesText.split(',').map((s) => s.trim()).filter(Boolean),
        seed: seedText ? Number(seedText) : null,
      };
      return influencer ? api.put<InfluencerView>(`/influencers/${influencer.id}`, body) : api.post<InfluencerView>('/influencers', body);
    },
    {
      invalidate: [qk.influencers, ...(influencer ? [qk.influencer(influencer.id)] : [])],
      success: (r) => `${r.name} ${influencer ? 'updated' : 'created'}`,
      onSuccess: (r) => {
        onOpenChange(false);
        onSaved?.(r);
      },
    },
  );

  const type = watch('characterType');
  const languages = watch('languages');
  const primary = watch('primaryLanguage');

  const toggleLang = (code: Language) => {
    const next = languages.includes(code) ? languages.filter((l) => l !== code) : [...languages, code];
    setValue('languages', next, { shouldValidate: true });
    if (!next.includes(primary) && next[0]) setValue('primaryLanguage', next[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{influencer ? `Edit ${influencer.name}` : 'Create influencer'}</DialogTitle>
          <DialogDescription>
            These settings define the character. The appearance prompt and master reference image keep every future generation consistent.
          </DialogDescription>
        </DialogHeader>
        <form id="influencer-form" onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            {(['human', 'cartoon'] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => {
                  setValue('characterType', t);
                  setValue('cartoonStyle', t === 'cartoon' ? '3d' : null);
                }}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                  type === t ? 'border-violet-500 bg-violet-500/10' : 'hover:bg-accent/50',
                )}
              >
                {t === 'human' ? <User className="mt-0.5 h-5 w-5 text-blue-400" /> : <Bot className="mt-0.5 h-5 w-5 text-violet-400" />}
                <div>
                  <p className="text-sm font-medium">{t === 'human' ? 'Realistic human' : 'Cartoon / animated'}</p>
                  <p className="text-xs text-muted-foreground">
                    {t === 'human' ? 'Photorealistic talking-head videos, natural human voice' : '2D, 3D, anime or illustrated original character, expressive voice'}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Name" error={errors.name?.message}><Input {...register('name')} placeholder="e.g. Aanya" /></Field>
            <Field label="Gender">
              <NativeSelect {...register('gender')}>
                <option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="other">Other</option>
              </NativeSelect>
            </Field>
            <Field label="Approximate age" error={errors.age?.message}><Input type="number" {...register('age')} /></Field>
            {type === 'cartoon' && (
              <Field label="Cartoon style" className="md:col-span-2">
                <Controller control={control} name="cartoonStyle" render={({ field }) => (
                  <NativeSelect value={field.value ?? '3d'} onChange={(e) => field.onChange(e.target.value)}>
                    {CARTOON_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </NativeSelect>
                )} />
              </Field>
            )}
            <Field label="Ethnicity / origin"><Input {...register('ethnicity')} placeholder="Indian" /></Field>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Personality" error={errors.personality?.message}><Textarea rows={3} {...register('personality')} placeholder="Friendly, curious, witty…" /></Field>
            <Field label="Appearance description" error={errors.appearance?.message}><Textarea rows={3} {...register('appearance')} placeholder="Skin tone, hair, eyes, distinctive features…" /></Field>
            <Field label="Clothing style"><Input {...register('clothingStyle')} placeholder="Modern casual, kurtis with sneakers…" /></Field>
            <Field label="Content niche(s)" hint="Comma separated"><Input {...register('nichesText')} placeholder="Lifestyle, Technology" /></Field>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Languages" error={errors.languages?.message}>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <button
                    type="button"
                    key={l.code}
                    onClick={() => toggleLang(l.code)}
                    className={cn('rounded-full border px-3 py-1 text-sm', languages.includes(l.code) ? 'border-violet-500 bg-violet-500/15 text-violet-200' : 'text-muted-foreground hover:bg-accent')}
                  >
                    {l.label} <span className="opacity-60">{l.native}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Primary language">
              <NativeSelect {...register('primaryLanguage')}>
                {LANGUAGES.filter((l) => languages.includes(l.code)).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Speaking style"><Input {...register('speakingStyle')} placeholder="Conversational Hinglish, fast-paced…" /></Field>
            <Field label="Accent"><Input {...register('accent')} placeholder="Neutral Indian" /></Field>
            <Field label="Voice profile" hint="Manage voices in Voice Studio">
              <Controller control={control} name="voiceProfileId" render={({ field }) => (
                <NativeSelect value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                  <option value="">— none —</option>
                  {voices?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </NativeSelect>
              )} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Pitch (semitones)">
                <Controller control={control} name="pitch" render={({ field }) => <Slider value={field.value} min={-12} max={12} step={1} onChange={field.onChange} format={(v) => (v > 0 ? `+${v}` : `${v}`)} />} />
              </Field>
              <Field label="Speaking speed">
                <Controller control={control} name="speakingSpeed" render={({ field }) => <Slider value={field.value} min={0.5} max={2} step={0.05} onChange={field.onChange} format={(v) => `${v.toFixed(2)}×`} />} />
              </Field>
            </div>
          </div>

          <Field label="Background story"><Textarea rows={3} {...register('backgroundStory')} placeholder="Where they grew up, what they do, why they create content…" /></Field>

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="mb-3 text-sm font-medium">Character consistency</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Master appearance prompt" hint="Prepended to every image prompt. Leave empty to build it from the fields above.">
                <Textarea rows={3} {...register('appearancePrompt')} />
              </Field>
              <Field label="Negative prompt"><Textarea rows={3} {...register('negativePrompt')} /></Field>
              <Field label="Fixed seed" hint="Optional – keeps compositions similar across generations" error={errors.seedText?.message}>
                <Input {...register('seedText')} placeholder="random" />
              </Field>
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="influencer-form" loading={save.isPending}>{influencer ? 'Save changes' : 'Create influencer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
