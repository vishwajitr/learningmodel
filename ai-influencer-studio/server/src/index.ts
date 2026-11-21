import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config, projectRoot } from './config.js';
import { seedIfEmpty } from './db/seed.js';
import { errorHandler } from './lib/http.js';
import { imagesRouter } from './routes/images.js';
import { influencersRouter } from './routes/influencers.js';
import { projectsRouter } from './routes/projects.js';
import { screenplaysRouter } from './routes/screenplays.js';
import { scriptsRouter } from './routes/scripts.js';
import { jobsRouter, systemRouter } from './routes/system.js';
import { voicesRouter } from './routes/voices.js';
import './services/generation.js'; // registers job handlers
import { startQueue } from './services/jobQueue.js';

const app = express();
app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/influencers', influencersRouter);
app.use('/api/images', imagesRouter);
app.use('/api/scripts', scriptsRouter);
app.use('/api/screenplays', screenplaysRouter);
app.use('/api/voices', voicesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/system', systemRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

app.use('/media', express.static(config.mediaDir, { maxAge: '1h', fallthrough: false }));

// Serve the built client in production (npm run build && npm start).
const clientDist = path.join(projectRoot, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

const seeded = await seedIfEmpty();
await startQueue();
app.listen(config.port, config.host, () => {
  console.log(`AI Influencer Studio API on http://${config.host}:${config.port}${seeded ? ' (default data installed)' : ''}`);
  console.log(`Data directory: ${config.dataDir}`);
});
