import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const InfluencersPage = lazy(() => import('@/pages/Influencers'));
const InfluencerDetailPage = lazy(() => import('@/pages/InfluencerDetail'));
const ImageStudioPage = lazy(() => import('@/pages/ImageStudio'));
const ScriptStudioPage = lazy(() => import('@/pages/ScriptStudio'));
const ScreenplayStudioPage = lazy(() => import('@/pages/ScreenplayStudio'));
const VoiceStudioPage = lazy(() => import('@/pages/VoiceStudio'));
const VideoStudioPage = lazy(() => import('@/pages/VideoStudio'));
const ProjectsPage = lazy(() => import('@/pages/Projects'));
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetail'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
import { EmptyState, LoadingBlock } from '@/components/common';
import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function App() {
  return (
    <Suspense fallback={<LoadingBlock />}>
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="influencers" element={<InfluencersPage />} />
        <Route path="influencers/:id" element={<InfluencerDetailPage />} />
        <Route path="image-studio" element={<ImageStudioPage />} />
        <Route path="scripts" element={<ScriptStudioPage />} />
        <Route path="scripts/:id" element={<ScriptStudioPage />} />
        <Route path="screenplays" element={<ScreenplayStudioPage />} />
        <Route path="screenplays/:id" element={<ScreenplayStudioPage />} />
        <Route path="voice-studio" element={<VoiceStudioPage />} />
        <Route path="video-studio" element={<VideoStudioPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <EmptyState
              icon={<Compass />}
              title="Page not found"
              description="This page doesn't exist."
              action={<Button asChild><Link to="/">Back to dashboard</Link></Button>}
            />
          }
        />
      </Route>
    </Routes>
    </Suspense>
  );
}
