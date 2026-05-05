const express = require('express');
const emailAddresses = require('email-addresses');
const { AppError } = require('../lib/errors');
const {
  isOwnedAddress,
} = require('../lib/address-ownership');

const createApiRoutes = ({
  db,
  helpers,
  csrf,
}) => {
  const router = express.Router();

  router.get('/api/user', async (req, res, next) => {
    try {
      const extUserId = await helpers.requireAuthenticatedUser(req);
      const user = await db.getUserByExtUserId(extUserId);
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'user is not found.', 404);
      }
      res.status(200).json({
        msg: 'Success',
        result: (({ ext_user_id, line_user_id }) => ({ ext_user_id, line_user_id }))(user)
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/recipient', async (req, res, next) => {
    try {
      const extUserId = await helpers.requireAuthenticatedUser(req);
      const availableRecipient = await helpers.getAvailableRecipient(extUserId);
      res.status(200).json({
        msg: 'Success',
        result: availableRecipient.map( rcpt => (({ ext_recipient_id, recipient_type, line_recipient_id, recipient_description, ext_addr_id, addr_mail }) => ({ ext_recipient_id, recipient_type, line_recipient_id, recipient_description, ext_addr_id, addr_mail }))(rcpt))
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/addr', async (req, res, next) => {
    try {
      const extUserId = await helpers.requireAuthenticatedUser(req);
      const registeredAddr = await db.getRegisteredAddrByExtUserId(extUserId);
      res.status(200).json({
        msg: 'Success',
        result: registeredAddr.map(addr => (({ ext_addr_id, addr_mail }) => ({ ext_addr_id, addr_mail }))(addr))
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/csrf-token', async (req, res, next) => {
    try {
      await helpers.requireAuthenticatedUser(req);
      res.status(200).json({
        msg: 'Success',
        result: {
          csrfToken: csrf.generateCsrfToken(req, res),
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/addr', csrf.doubleCsrfProtection, async (req, res, next) => {
    try {
      const extUserId = await helpers.requireAuthenticatedUser(req);
      const inputEmail = req.body.formInputEmail;
      const inputRecipient = req.body.formInputRecipient;
      if(!inputEmail) {
        throw new AppError('EMAIL_REQUIRED', 'Email address is empty.', 400);
      }
      if(!inputRecipient) {
        throw new AppError('RECIPIENT_REQUIRED', 'Recipient is empty.', 400);
      }
      let emailAddr = inputEmail;
      if (inputEmail.indexOf('@') === -1) {
        emailAddr = `${inputEmail}@local`;
      }
      const emailObj = emailAddresses.parseOneAddress(emailAddr);
      if(!emailObj || !emailObj.local) {
        throw new AppError('EMAIL_INVALID', 'Email address is invalid format.', 400);
      }
      if(emailObj.local.length < 4) {
        throw new AppError('EMAIL_TOO_SHORT', 'Email address is too short.', 400);
      }
      emailAddr = emailObj.local.toLowerCase();
      if(await db.getAddrByEmail(emailAddr)) {
        throw new AppError('EMAIL_ALREADY_EXISTS', 'Email address is already exists.', 400);
      }

      const availableRecipient = await helpers.getAvailableRecipient(extUserId);
      const extRecipient = availableRecipient.find(rcpt => rcpt.ext_recipient_id === inputRecipient);
      if(!extRecipient) {
        throw new AppError('RECIPIENT_NOT_FOUND', 'Recipient is not found.', 400);
      }
      const extRecipientId = extRecipient.ext_recipient_id;
      if(!extRecipientId) {
        throw new AppError('RECIPIENT_UNAVAILABLE', 'Recipient ' + extRecipientId + ' is not available.', 400);
      }
      await db.addAddr(emailAddr, extUserId, extRecipientId);
      const addr = await db.getAddrByEmail(emailAddr);
      res.status(200).json({
        msg: 'Success',
        result: (({ ext_addr_id, addr_mail }) => ({ ext_addr_id, addr_mail }))(addr)
      });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/addr/:extAddrId', csrf.doubleCsrfProtection, async (req, res, next) => {
    try {
      const extAddrId = req.params.extAddrId;
      const extUserId = await helpers.requireAuthenticatedUser(req);
      const addr = await db.getAddrByExtAddrId(extAddrId);
      if (!addr) {
        throw new AppError('ADDRESS_NOT_FOUND', 'Address is not found.', 404);
      }
      const registeredAddr = await db.getRegisteredAddrByExtUserId(extUserId);
      if (!isOwnedAddress(addr, registeredAddr)) {
        throw new AppError('ADDRESS_NOT_OWNED', 'Address is not registered by this user.', 404, {
          extAddrId,
        });
      }
      await db.delAddr(extAddrId);
      res.status(200).json({ msg: 'Success', result: [ extAddrId ]});
    } catch (e) {
      next(e);
    }
  });

  return router;
};

module.exports = {
  createApiRoutes,
};
