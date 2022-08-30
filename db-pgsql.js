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

  async createUser(lineUserId) {
    debug('db:createUser');
    const userId = await this.getUser(lineUserId)
      .catch((msg) => Promise.reject(msg));
    if (userId) {
      return userId;
    }
    await this.setUser(lineUserId)
      .catch((msg) => Promise.reject(msg));
    return this.getUser(lineUserId);
  }

  async getUser(lineUserId) {
    debug('db:getUser');
    const res = await this.database.any('SELECT * FROM user_master WHERE line_user_id = $1', [lineUserId])
      .catch((msg) => Promise.reject(msg));
    debug('db:getUser:select', res);
    if (res.length === 1) {
      return res[0].user_id;
    }
    if (res.length > 1) {
      throw new Error(`SystemError: Duplicate user ${lineUserId}`);
    }
    return null;
  }

  async setUser(lineUserId) {
    debug('db:setUser');
    await this.database.none('INSERT INTO user_master(user_id,line_user_id) VALUES (NEXTVAL(\'seq_user_master\'), $1)', [lineUserId])
      .then(() => debug('db:setUser:inserted'))
      .catch((msg) => Promise.reject(msg));
  }

  async getAddr(userId) {
    debug('db:getAddr');
    const res = await this.database.any('SELECT * FROM addr_master WHERE user_id = $1', userId)
      .catch((msg) => Promise.reject(msg));
    debug('db:getAddr:select', res);
    return res;
  }

  async getNotifyToken(addrId) {
    debug('db:getNotifyToken');
    const res = await this.database.any('SELECT notify_token FROM addr_master WHERE addr_id = $1', [addrId])
      .catch((msg) => Promise.reject(msg));
    debug('db:getNotifyToken:select', res);
    if (res.length === 1) {
      return res[0].notify_token;
    }
    return null;
  }

  async getEnabledNotifyTokenByAddr(addr) {
    debug('db:getEnabledNotifyTokenByAddr');
    const res = await this.database.any('SELECT notify_token FROM addr_master WHERE addr_mail = $1 AND status = 1', [addr])
      .catch((msg) => Promise.reject(msg));
    debug('db:getEnabledNotifyTokenByAddr:select', res);
    if (res.length === 1) {
      return res[0].notify_token;
    }
    return null;
  }

  async setAddr(email, userId, notifyToken, status) {
    debug('db:setAddr');
    await this.database.none('INSERT INTO addr_master(addr_id,addr_mail,user_id,notify_token,status) VALUES (NEXTVAL(\'seq_addr_master\'), $1, $2, $3, $4)', [email, userId, notifyToken, status])
      .then(() => debug('db:setAddr:inserted'))
      .catch((msg) => Promise.reject(msg));
  }

  async unsetAddr(addrId) {
    debug('db:unsetAddr');
    await this.database.none('DELETE FROM addr_master WHERE addr_id = $1', [addrId])
      .then(() => debug('db:unsetAddr:deleted'))
      .catch((msg) => Promise.reject(msg));
  }

  async enableAddr(addrId) {
    debug('db:enableAddr');
    await this.database.none('UPDATE addr_master SET status=1 WHERE status<>1 AND addr_id = $1', [addrId])
      .then(() => debug('db:enableAddr:updated'))
      .catch((msg) => Promise.reject(msg));
  }

  async disableAddr(addrId) {
    debug('db:disableAddr');
    await this.database.none('UPDATE addr_master SET status=0 WHERE status<>0 AND addr_id = $1', [addrId])
      .then(() => debug('db:disableAddr:updated'))
      .catch((msg) => Promise.reject(msg));
  }

  async isDupAddr(addr) {
    debug('db:isDupAddr');
    const res = await this.database.any('SELECT COUNT(*) FROM addr_master WHERE addr_mail = $1', [addr])
      .catch((msg) => Promise.reject(msg));
    debug('db:isDupAddr:select', res);
    return parseInt(res[0].count, 10) > 0;
  }
}
module.exports = Database;
