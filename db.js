const debug = require('debug')('db');
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
      ssl: { sslmode: 'require', rejectUnauthorized: false }
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
    const res = await this.database.any('SELECT * FROM USER_MASTER WHERE LINE_USER_ID = $1', [lineUserId])
      .catch((msg) => Promise.reject(msg));
    debug('db:getUser:select', res);
    if (res.length === 1) {
      return res[0].user_id;
    }
    if (res.length > 1) {
      throw new Error(`SystemError: Duplicate user ${lineUserId}`);
    }
    return undefined;
  }

  async setUser(lineUserId) {
    debug('db:setUser');
    await this.database.none('INSERT INTO USER_MASTER(USER_ID,LINE_USER_ID) VALUES (NEXTVAL(\'SEQ_USER_MASTER\'), $1)', [lineUserId])
      .then(() => debug('db:setUser:inserted'))
      .catch((msg) => Promise.reject(msg));
  }

  async getAddr(userId) {
    debug('db:getAddr');
    const res = await this.database.any('SELECT * FROM ADDR_MASTER WHERE USER_ID = $1', userId)
      .catch((msg) => Promise.reject(msg));
    debug('db:getAddr:select', res);
    return res;
  }

  async getNotifyToken(addrId) {
    debug('db:getNotifyToken');
    const res = await this.database.any('SELECT NOTIFY_TOKEN FROM ADDR_MASTER WHERE ADDR_ID = $1', [addrId])
      .catch((msg) => Promise.reject(msg));
    debug('db:getNotifyToken:select', res);
    if (res.length === 1) {
      return res[0].notify_token;
    }
    return undefined;
  }

  async getEnabledNotifyTokenByAddr(addr) {
    debug('db:getEnabledNotifyTokenByAddr');
    const res = await this.database.any('SELECT NOTIFY_TOKEN FROM ADDR_MASTER WHERE ADDR_MAIL = $1 AND STATUS = 1', [addr])
      .catch((msg) => Promise.reject(msg));
    debug('db:getEnabledNotifyTokenByAddr:select', res);
    if (res.length === 1) {
      return res[0].notify_token;
    }
    return undefined;
  }

  async setAddr(email, userId, notifyToken, status) {
    debug('db:setAddr');
    await this.database.none('INSERT INTO ADDR_MASTER(ADDR_ID,ADDR_MAIL,USER_ID,NOTIFY_TOKEN, STATUS) VALUES (NEXTVAL(\'SEQ_ADDR_MASTER\'), $1, $2, $3, $4)', [email, userId, notifyToken, status])
      .then(() => debug('db:setAddr:inserted'))
      .catch((msg) => Promise.reject(msg));
  }

  async unsetAddr(addrId) {
    debug('db:unsetAddr');
    await this.database.none('DELETE FROM ADDR_MASTER WHERE ADDR_ID = $1', [addrId])
      .then(() => debug('db:unsetAddr:deleted'))
      .catch((msg) => Promise.reject(msg));
  }

  async enableAddr(addrId) {
    debug('db:enableAddr');
    await this.database.none('UPDATE ADDR_MASTER SET STATUS=1 WHERE STATUS<>1 AND ADDR_ID = $1', [addrId])
      .then(() => debug('db:enableAddr:updated'))
      .catch((msg) => Promise.reject(msg));
  }

  async disableAddr(addrId) {
    debug('db:disableAddr');
    await this.database.none('UPDATE ADDR_MASTER SET STATUS=0 WHERE STATUS<>0 AND ADDR_ID = $1', [addrId])
      .then(() => debug('db:disableAddr:updated'))
      .catch((msg) => Promise.reject(msg));
  }

  async isDupAddr(addr) {
    debug('db:isDupAddr');
    const res = await this.database.any('SELECT COUNT(*) FROM ADDR_MASTER WHERE ADDR_MAIL = $1', [addr])
      .catch((msg) => Promise.reject(msg));
    debug('db:isDupAddr:select', res);
    return parseInt(res[0].count, 10) > 0;
  }
}
module.exports = Database;
