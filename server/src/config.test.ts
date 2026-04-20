import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all relevant env vars
    delete process.env.PORT;
    delete process.env.BBL_SOCKET_URL;
    delete process.env.BBL_SOCKET_API_KEY;
    delete process.env.PLANNING_DESK_API_URL;
    delete process.env.PLANNING_DESK_API_KEY;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when BBL_SOCKET_API_KEY is missing', () => {
    process.env.SESSION_SECRET = 'test-secret';
    process.env.PLANNING_DESK_API_KEY = 'pd-key';
    expect(() => loadConfig()).toThrow('BBL_SOCKET_API_KEY');
  });

  it('throws when PLANNING_DESK_API_KEY is missing', () => {
    process.env.SESSION_SECRET = 'test-secret';
    process.env.BBL_SOCKET_API_KEY = 'bbl-key';
    expect(() => loadConfig()).toThrow('PLANNING_DESK_API_KEY');
  });

  it('throws listing both keys when both are missing', () => {
    process.env.SESSION_SECRET = 'test-secret';
    expect(() => loadConfig()).toThrow('BBL_SOCKET_API_KEY');
    expect(() => loadConfig()).toThrow('PLANNING_DESK_API_KEY');
  });

  it('throws when SESSION_SECRET is missing', () => {
    process.env.BBL_SOCKET_API_KEY = 'bbl-key';
    process.env.PLANNING_DESK_API_KEY = 'pd-key';
    expect(() => loadConfig()).toThrow('SESSION_SECRET');
  });

  it('returns config with defaults when only required keys are set', () => {
    process.env.SESSION_SECRET = 'test-secret';
    process.env.BBL_SOCKET_API_KEY = 'bbl-key';
    process.env.PLANNING_DESK_API_KEY = 'pd-key';

    const config = loadConfig();

    expect(config.port).toBe(3001);
    expect(config.bblSocketUrl).toBe('https://api.bbl.scb.world');
    expect(config.bblSocketApiKey).toBe('bbl-key');
    expect(config.planningDeskApiUrl).toBe('https://api.desk.dyn.sport/planning/api');
    expect(config.planningDeskApiKey).toBe('pd-key');
    expect(config.sessionSecret).toBe('test-secret');
  });

  it('reads all values from environment variables', () => {
    process.env.PORT = '8080';
    process.env.SESSION_SECRET = 'my-secret';
    process.env.BBL_SOCKET_URL = 'https://custom-bbl.example.com';
    process.env.BBL_SOCKET_API_KEY = 'my-bbl-key';
    process.env.PLANNING_DESK_API_URL = 'https://custom-pd.example.com';
    process.env.PLANNING_DESK_API_KEY = 'my-pd-key';

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.bblSocketUrl).toBe('https://custom-bbl.example.com');
    expect(config.bblSocketApiKey).toBe('my-bbl-key');
    expect(config.planningDeskApiUrl).toBe('https://custom-pd.example.com');
    expect(config.planningDeskApiKey).toBe('my-pd-key');
    expect(config.sessionSecret).toBe('my-secret');
  });

  it('does not hardcode any API key defaults', () => {
    // With no env vars set, it should throw — not return hardcoded keys
    expect(() => loadConfig()).toThrow('Missing required environment variable');
  });
});
