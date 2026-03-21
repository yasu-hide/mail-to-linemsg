const regenerateSession = (req) => new Promise((resolve, reject) => {
  req.session.regenerate((error) => {
    if (error) {
      reject(error);
      return;
    }

    resolve();
  });
});

const regenerateSessionWithUser = async (req, userId) => {
  await regenerateSession(req);
  req.session.userId = userId;
};

module.exports = {
  regenerateSession,
  regenerateSessionWithUser,
};
