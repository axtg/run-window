// Load test-specific overrides first, then fall back to .env for vars not pinned by .env.test.
require('dotenv').config({ path: '.env.test' });
require('dotenv').config();

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};
