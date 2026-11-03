const http = require('http');

const options = {
  host: '127.0.0.1',
  port: process.env.PORT || 3003,
  path: '/health',
  timeout: 2000
};

const request = http.request(options, res => {
  console.log(`Health check status: ${res.statusCode}`);
  process.exit(res.statusCode === 200 ? 0 : 1);
});

request.on('error', err => {
  console.log('Health check failed:', err.message);
  process.exit(1);
});

request.end();
