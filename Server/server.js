/* global __dirname */
const express = require('express');
const cors = require('cors');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const authRoutes = require('./routes/auth');
const projectsRoutes = require('./routes/projects');
const tasksRoutes = require('./routes/tasks');
const notificationsRoutes = require('./routes/notifications');
const usersRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const siteProgressRoutes = require('./routes/siteProgress');
const inventoryRoutes = require('./routes/inventory');
const aiRoutes = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }

  next(err);
});
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/auth', authRoutes);
app.use('/projects', projectsRoutes);
app.use('/tasks', tasksRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/users', usersRoutes);
app.use('/upload', uploadRoutes);
app.use('/site-progress', siteProgressRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/api/ai', aiRoutes);
// Phase 2 spec path: /api/projects/:projectId/inventory
app.use('/api/projects/:projectId/inventory', (req, res, next) => {
  // Inject projectId into query for route handlers that expect it
  req.query.projectId = req.query.projectId || req.params.projectId;
  next();
}, inventoryRoutes);

app.get('/', (req, res) => res.send('BuildSphere API is running ✅'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ BuildSphere API running at http://0.0.0.0:${PORT}`);
});
