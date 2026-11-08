module.exports = {
  apps: [{
    name: 'beats-rename',
    script: 'server.js',
    cwd: __dirname,
    env: { PORT: 3000, ROOT_DIR: process.env.HOME || process.env.USERPROFILE },
    autorestart: true,
    max_restarts: 10,
  }],
};
