/**
 * Integration-style test for the pipeline job.
 * All external services (Google Places, Supabase) are mocked.
 */

jest.mock('../src/services/googlePlacesService');
jest.mock('../src/db/leadsRepository');

const { fetchLeads } = require('../src/services/googlePlacesService');
const { upsertLeads } = require('../src/db/leadsRepository');
const { runPipeline } = require('../src/jobs/leadPipeline');

const mockLeads = [
  {
    place_id: 'p1',
    name: 'No Website Spa',
    city: 'Miami',
    address: '1 Spa St',
    phone: '305-000-0001',
    website: null,
    has_website: false,
    rating: 4.0,
    types: ['spa'],
  },
  {
    place_id: 'p2',
    name: 'Has Website Salon',
    city: 'Miami',
    address: '2 Salon Ave',
    phone: '305-000-0002',
    website: 'https://salon.com',
    has_website: true,
    rating: 4.5,
    types: ['hair_care'],
  },
  {
    place_id: 'p3',
    name: 'FB-Only Clinic',
    city: 'Miami',
    address: '3 Clinic Rd',
    phone: '305-000-0003',
    website: 'https://facebook.com/clinic',
    has_website: true,
    rating: 3.8,
    types: ['doctor'],
  },
];

beforeEach(() => {
  fetchLeads.mockResolvedValue(mockLeads);
  upsertLeads.mockResolvedValue({ inserted: 3 });
});

afterEach(() => jest.clearAllMocks());

describe('runPipeline', () => {
  test('returns correct summary counts', async () => {
    const result = await runPipeline('Miami', ['spa', 'hair salon']);

    expect(result.city).toBe('Miami');
    expect(result.total).toBe(3);
    // p1 (null website) + p3 (FB-only, annotated to no-website)
    expect(result.noWebsite).toBe(2);
    expect(result.stored).toBe(3); // all leads stored, not just filtered
  });

  test('calls upsertLeads with annotated leads', async () => {
    await runPipeline('Miami', ['spa']);
    const [calledLeads] = upsertLeads.mock.calls[0];

    // FB-only lead should be annotated as has_website=false
    const fbLead = calledLeads.find((l) => l.place_id === 'p3');
    expect(fbLead.has_website).toBe(false);
    expect(fbLead.website).toBeNull();
  });

  test('handles zero results gracefully', async () => {
    fetchLeads.mockResolvedValue([]);
    upsertLeads.mockResolvedValue({ inserted: 0 });

    const result = await runPipeline('EmptyCity', ['spa']);
    expect(result.total).toBe(0);
    expect(result.noWebsite).toBe(0);
  });
});
