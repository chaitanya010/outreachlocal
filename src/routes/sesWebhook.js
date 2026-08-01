'use strict';

const { Router } = require('express');
const express = require('express');
const axios = require('axios');
const { suppressEmailAddress } = require('../db/leadsRepository');
const logger = require('../utils/logger');

const router = Router();

/**
 * SES bounce/complaint suppression via SNS.
 *
 * AWS setup (one-time, per verified identity):
 *   1. SES console -> Verified identities -> stanweb.tech -> Notifications
 *      -> create/select an SNS topic for "Bounce" and one for "Complaint"
 *      (can be the same topic for both).
 *   2. SNS console -> that topic -> Create subscription -> Protocol: HTTPS,
 *      Endpoint: https://<this server>/webhooks/ses-notifications
 *   3. SNS immediately POSTs a SubscriptionConfirmation message here, which
 *      this handler auto-confirms by hitting its SubscribeURL. After that,
 *      real Bounce/Complaint notifications start arriving as POSTs.
 *
 * Only PERMANENT bounces (mailbox doesn't exist, domain doesn't exist) are
 * suppressed -- transient bounces (mailbox full, temporary server issue)
 * are expected to resolve on their own and shouldn't permanently kill a lead.
 * Any complaint (recipient marked it spam) is suppressed immediately.
 */
router.post('/webhooks/ses-notifications', express.text({ type: '*/*' }), async (req, res) => {
  let body;
  try {
    body = JSON.parse(req.body);
  } catch (err) {
    logger.error('SES webhook: invalid JSON body', { message: err.message });
    return res.status(400).send('invalid body');
  }

  try {
    if (body.Type === 'SubscriptionConfirmation') {
      await axios.get(body.SubscribeURL);
      logger.info('SES webhook: SNS subscription confirmed', { topicArn: body.TopicArn });
      return res.status(200).send('subscribed');
    }

    if (body.Type === 'Notification') {
      const message = JSON.parse(body.Message);

      if (message.notificationType === 'Bounce' && message.bounce?.bounceType === 'Permanent') {
        const emails = (message.bounce.bouncedRecipients || []).map((r) => r.emailAddress).filter(Boolean);
        for (const email of emails) await suppressEmailAddress(email, 'bounced');
        logger.info('SES webhook: suppressed hard bounces', { count: emails.length });
      } else if (message.notificationType === 'Complaint') {
        const emails = (message.complaint.complainedRecipients || []).map((r) => r.emailAddress).filter(Boolean);
        for (const email of emails) await suppressEmailAddress(email, 'complained');
        logger.info('SES webhook: suppressed complaints', { count: emails.length });
      }

      return res.status(200).send('ok');
    }

    return res.status(200).send('ignored');
  } catch (err) {
    logger.error('SES webhook processing failed', { message: err.message });
    return res.status(500).send('error');
  }
});

module.exports = router;
