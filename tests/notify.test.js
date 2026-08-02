jest.mock('../src/services/emailService', () => ({ sendEmail: jest.fn() }));

const { sendEmail } = require('../src/services/emailService');
const { notifyOwner } = require('../src/utils/notify');

describe('notifyOwner', () => {
  const originalNotifyEmail = process.env.NOTIFY_EMAIL;

  afterEach(() => {
    process.env.NOTIFY_EMAIL = originalNotifyEmail;
    jest.clearAllMocks();
  });

  test('no-ops when NOTIFY_EMAIL is unset', async () => {
    delete process.env.NOTIFY_EMAIL;
    await notifyOwner('subject', 'body');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('sends to NOTIFY_EMAIL when set', async () => {
    process.env.NOTIFY_EMAIL = 'owner@stanweb.tech';
    sendEmail.mockResolvedValue({ messageId: 'abc' });
    await notifyOwner('Booking link sent', 'details here');
    expect(sendEmail).toHaveBeenCalledWith({ to: 'owner@stanweb.tech', subject: 'Booking link sent', text: 'details here' });
  });

  test('swallows send errors without throwing', async () => {
    process.env.NOTIFY_EMAIL = 'owner@stanweb.tech';
    sendEmail.mockRejectedValue(new Error('SES down'));
    await expect(notifyOwner('subject', 'body')).resolves.toBeUndefined();
  });
});
