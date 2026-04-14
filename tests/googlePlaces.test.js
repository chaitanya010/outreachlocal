/**
 * Unit tests for googlePlacesService normalizeLead.
 * Network calls are mocked — no real API key needed.
 */

const { normalizeLead } = require('../src/services/googlePlacesService');

describe('normalizeLead', () => {
  const rawPlace = {
    place_id: 'ChIJtest123',
    name: 'Serenity Spa',
    formatted_address: '123 Main St, Miami, FL 33101, USA',
    formatted_phone_number: '(305) 555-1234',
    website: 'https://serenityspa.com',
    rating: 4.5,
    types: ['spa', 'beauty_salon'],
  };

  test('maps all fields correctly', () => {
    const lead = normalizeLead(rawPlace, 'Miami');
    expect(lead).toMatchObject({
      place_id: 'ChIJtest123',
      name: 'Serenity Spa',
      city: 'Miami',
      address: '123 Main St, Miami, FL 33101, USA',
      phone: '(305) 555-1234',
      website: 'https://serenityspa.com',
      has_website: true,
      rating: 4.5,
      types: ['spa', 'beauty_salon'],
    });
  });

  test('sets has_website=false when website missing', () => {
    const lead = normalizeLead({ ...rawPlace, website: undefined }, 'Miami');
    expect(lead.has_website).toBe(false);
    expect(lead.website).toBeNull();
  });

  test('handles missing phone gracefully', () => {
    const lead = normalizeLead({ ...rawPlace, formatted_phone_number: undefined }, 'Miami');
    expect(lead.phone).toBeNull();
  });

  test('falls back to vicinity when formatted_address missing', () => {
    const lead = normalizeLead(
      { ...rawPlace, formatted_address: undefined, vicinity: '123 Main St' },
      'Miami'
    );
    expect(lead.address).toBe('123 Main St');
  });
});
