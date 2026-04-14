/**
 * HTTP API endpoint tests using supertest.
 * Pipeline and DB are mocked — no external calls.
 */

jest.mock('../src/jobs/leadPipeline');
jest.mock('../src/db/leadsRepository');
jest.mock('../src/config', () => ({
  config: {
    google: { apiKey: 'test', maxResults: 60 },
    supabase: { url: 'http://test', serviceKey: 'test' },
    enrichment: {},
    server: { port: 3000, env: 'test' },
    pipeline: { requestDelayMs: 0 },
  },
  validate: jest.fn(),
}));

const request = require('supertest');
const app = require('../server');
const { runPipeline } = require('../src/jobs/leadPipeline');
const { getLeads } = require('../src/db/leadsRepository');

const mockSummary = { city: 'Miami', total: 20, noWebsite: 12, stored: 20 };
const mockLead = {
  id: 'uuid-1',
  place_id: 'p1',
  name: 'Test Spa',
  city: 'Miami',
  has_website: false,
};

beforeEach(() => {
  runPipeline.mockResolvedValue(mockSummary);
  getLeads.mockResolvedValue({ leads: [mockLead], total: 1 });
});

afterEach(() => jest.clearAllMocks());

describe('POST /generate-leads', () => {
  test('returns 200 with summary on valid request', async () => {
    const res = await request(app)
      .post('/generate-leads')
      .send({ city: 'Miami', types: ['spa'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.noWebsite).toBe(12);
  });

  test('returns 400 when city is missing', async () => {
    const res = await request(app).post('/generate-leads').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/i);
  });

  test('uses default types when types not provided', async () => {
    await request(app).post('/generate-leads').send({ city: 'Austin' });
    expect(runPipeline).toHaveBeenCalledWith('Austin', expect.any(Array));
  });
});

describe('GET /leads', () => {
  test('returns leads array', async () => {
    const res = await request(app).get('/leads');
    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  test('passes noWebsite filter to repository', async () => {
    await request(app).get('/leads?noWebsite=true');
    expect(getLeads).toHaveBeenCalledWith(expect.objectContaining({ noWebsite: true }));
  });

  test('caps limit at 500', async () => {
    await request(app).get('/leads?limit=9999');
    expect(getLeads).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });
});

describe('GET /health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
