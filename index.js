require('dotenv').config();

const { createApp } = require('./app');

const app = createApp();

if (require.main === module) {
  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`run-window API listening on http://${host}:${port}`);
  });
}

module.exports = app;
