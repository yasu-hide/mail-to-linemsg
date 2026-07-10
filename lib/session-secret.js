const requireSessionSecret = (env = process.env) => {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET is not set. Set a dedicated random secret (no fallback).',
    );
  }
  return secret;
};

module.exports = {
  requireSessionSecret,
};
