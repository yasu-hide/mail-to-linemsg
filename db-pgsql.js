const { ReasonCodes } = require('mqtt');

const debug = require('debug')('db-pgsql');
const pgPromise = require('pg-promise')({ noWarnings: true });

class Database {
  constructor(options) {
    const requiredParams = ['databaseURL'];
    requiredParams.forEach((param) => {
      if (!options[param]) {
        throw new Error(`Required parameter ${param} is missing.`);
      }
    });
    this.database = pgPromise({
      connectionString: options.databaseURL,
    });
  }

  async addUser(lineUserId) {
    debug('db:createUser');
    let user;
    user = await this.getUserByLineUserId(lineUserId);
    if (user) {
      return user;
    }
    await this.database.none('INSERT INTO user_master(line_user_id) VALUES ($1)', [lineUserId])
    debug('db:createUser:userInserted');
    user = await this.getUserByLineUserId(lineUserId);
    debug(user);
    if (user) {
      return user;
    }
    throw new Error(`SystemError: cannot add user ${lineUserId}`);
  }

  async getUserByLineUserId(lineUserId) {
    debug('db:getUserByLineUserId');
    const res = await this.database.any('SELECT * FROM user_master WHERE line_user_id = $1', [lineUserId]);
    debug('db:getUserByLineUserId:select', res);
    debug(res.length);
    if(res.length === 0) {
      return null;
    }
    if (res.length === 1) {
      return res[0];
    }
    throw new Error(`SystemError: duplicate user ${lineUserId}`);
  }

  async getUserByExtUserId(extUserId) {
    debug('db:getUserByExtUserId');
    const res = await this.database.any('SELECT * FROM user_master WHERE ext_user_id = $1', [extUserId]);
    debug('db:getUserByExtUserId:select', res);
    if(res.length === 0) {
      return null;
    }
    if (res.length === 1) {
      return res[0];
    }
    throw new Error(`SystemError: duplicate user ${extUserId}`);
  }

  async addRecipient(lineRecipientId, recipientType, recipientDescription, extRecipientId=undefined) {
    debug('db:addRecipient');
    let recipient;
    recipient = await this.getRecipientByLineRecipientId(lineRecipientId);
    if (recipient) {
      return recipient;
    }
    if(extRecipientId) {
      await this.database.none('INSERT INTO recipient_master(line_recipient_id, recipient_type, recipient_description, ext_recipient_id) VALUES ($1, $2, $3, $4)', [lineRecipientId, recipientType, recipientDescription, extRecipientId]);
    } else {
      await this.database.none('INSERT INTO recipient_master(line_recipient_id, recipient_type, recipient_description) VALUES ($1, $2, $3)', [lineRecipientId, recipientType, recipientDescription]);
    }
    debug('db:addRecipient:inserted');
    recipient = await this.getRecipientByLineRecipientId(lineRecipientId);
    if (recipient) {
      return recipient;
    }
    throw new Error(`SystemError: cannot create recipient ${lineRecipientId}`);
  }

  async getRecipientByLineRecipientId(lineRecipientId) {
    debug('db:getRecipientByLineRecipientId');
    const res = await this.database.any('SELECT * FROM recipient_master WHERE line_recipient_id=$1', ([lineRecipientId]));
    debug('db:getRecipientByLineRecipientId:select', res);
    if(res.length === 0) {
      return null;
    }
    if(res.length === 1) {
      return res[0];
    }
    throw new Error(`SystemError: duplicate recipient ${lineRecipientId}`);
  }

  async getRecipientAll() {
    debug('db:getRecipientAll');
    return await this.database.any('SELECT rcpm.*,adrm.* FROM recipient_master rcpm LEFT OUTER JOIN addr_master adrm ON rcpm.recipient_id=adrm.recipient_id');
  }

  async addAddr(emailAddr, extUserId, extRecipientId, status=1) {
    debug('db:addAddr');
    let addr;
    addr = await this.getAddrByEmail(emailAddr);
    debug(addr);
    if (addr) {
      return addr;
    }
    await this.database.none('INSERT INTO addr_master(addr_mail,user_id,recipient_id,status) VALUES ($1, (SELECT user_id FROM user_master WHERE ext_user_id=$2), (SELECT recipient_id FROM recipient_master WHERE ext_recipient_id=$3), $4)', [emailAddr, extUserId, extRecipientId, status]);
    debug('db:addAddr:inserted');
    addr = await this.getAddrByEmail(emailAddr);
    if (addr) {
      return addr;
    }
    throw new Error(`SystemError: cannot create addr ${email}`);
  }

  async getAddrByEmail(emailAddr) {
    debug('db:getAddrByEmail');
    const res = await this.database.any('SELECT * FROM addr_master WHERE addr_mail = $1', [emailAddr]);
    debug('db:getAddrByEmail:select', res);
    if(res.length === 0) {
      return null;
    }
    if(res.length === 1) {
      return res[0];
    }
    throw new Error(`SystemError: duplicate e-mail address ${email}`);
  }

  async getAddrByExtAddrId(extAddrId) {
    debug('db:getAddrByExtAddrId');
    const res = await this.database.any('SELECT * FROM addr_master WHERE ext_addr_id = $1', [extAddrId]);
    debug('db:getAddrByExtAddrId:select', res);
    if(res.length === 0) {
      return null;
    }
    if(res.length === 1) {
      return res[0];
    }
    throw new Error(`SystemError: duplicate e-mail address ${extAddrId}`);
  }

  async delAddr(extAddrId) {
    debug('db:delAddr');
    await this.database.none('DELETE FROM addr_master WHERE ext_addr_id = $1', [extAddrId]);
    debug('db:delAddr:deleted');
  }

  async enableAddr(extAddrId) {
    debug('db:enableAddr');
    await this.database.none('UPDATE addr_master SET status=1 WHERE status<>1 AND ext_addr_id = $1', [extAddrId]);
    debug('db:enableAddr:enabled');
  }

  async disableAddr(extAddrId) {
    debug('db:disableAddr');
    await this.database.none('UPDATE addr_master SET status=0 WHERE status<>0 AND ext_addr_id = $1', [extAddrId])
    debug('db:disableAddr:disabled');
  }

  async getRegisteredAddrByExtUserId(extUserId) {
    debug('db:getRegisteredAddrByExtUserId');
    const res = await this.database.any('SELECT DISTINCT(adrm.*) FROM addr_master adrm, user_master usrm WHERE adrm.user_id = usrm.user_id AND usrm.ext_user_id = $1', extUserId);
    debug('db:getRegisteredAddrByExtUserId:select', res);
    return res;
  }

  async getEnabledRecipientByEmail(emailAddr) {
    debug('db:getEnabledRecipientByEmail');
    const res = await this.database.any('SELECT DISTINCT(rcpm.*) FROM recipient_master rcpm, addr_master adrm WHERE rcpm.recipient_id = adrm.recipient_id AND adrm.status = 1 AND adrm.addr_mail = $1', [emailAddr]);
    debug('db:getEnabledRecipientByEmail:select', res);
    if(res.length === 0) {
      return null;
    }
    if(res.length === 1) {
      return res[0];
    }
    throw new Error(`SystemError: duplicate e-mail address ${emailAddr}`);
  }

  async getEnabledRecipientByExtUserId(extUserId) {
    debug('db:getEnabledRecipientByExtUserId');
    const res = await this.database.any('SELECT DISTINCT(rcpm.*) FROM recipient_master rcpm, addr_master adrm, user_master usrm WHERE rcpm.recipient_id = adrm.recipient_id AND adrm.user_id = usrm.user_id AND adrm.status =1 AND usrm.ext_user_id = $1', [extUserId]);
    debug('db:getEnabledRecipientByExtUserId:select');
    return res;
  }
}
module.exports = Database;
