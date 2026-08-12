const { categoryForLead } = require('../src/services/nicheCategory');

describe('categoryForLead', () => {
  test('classifies emergency home services', () => {
    expect(categoryForLead({ business_type: 'HVAC' })).toBe('emergency_home_service');
    expect(categoryForLead({ business_type: 'Plumbing Company' })).toBe('emergency_home_service');
    expect(categoryForLead({ business_type: 'Garage Door Repair' })).toBe('emergency_home_service');
  });

  test('classifies hospitality/food', () => {
    expect(categoryForLead({ business_type: 'Restaurant' })).toBe('hospitality_food');
    expect(categoryForLead({ business_type: 'Event Planner' })).toBe('hospitality_food');
  });

  test('classifies b2b industrial', () => {
    expect(categoryForLead({ business_type: 'Warehousing' })).toBe('b2b_industrial');
    expect(categoryForLead({ business_type: 'Staffing & Recruiting' })).toBe('b2b_industrial');
    expect(categoryForLead({ business_type: 'Machinery' })).toBe('b2b_industrial');
  });

  test('classifies b2b professional services', () => {
    expect(categoryForLead({ business_type: 'Financial Services' })).toBe('b2b_professional');
    expect(categoryForLead({ business_type: 'Law Practice' })).toBe('b2b_professional');
    expect(categoryForLead({ business_type: 'Insurance Agency' })).toBe('b2b_professional');
    expect(categoryForLead({ business_type: 'Construction' })).toBe('b2b_professional');
  });

  test('defaults to appointment_consumer for consumer-facing and unknown types', () => {
    expect(categoryForLead({ business_type: 'Nail Salon' })).toBe('appointment_consumer');
    expect(categoryForLead({ business_type: 'Dental Clinic' })).toBe('appointment_consumer');
    expect(categoryForLead({ business_type: 'Something Totally Unmapped' })).toBe('appointment_consumer');
    expect(categoryForLead({ business_type: null })).toBe('appointment_consumer');
    expect(categoryForLead({})).toBe('appointment_consumer');
  });
});
