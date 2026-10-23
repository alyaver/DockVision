function createRequireAuthenticatedUser({ db }) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Authenticated-user middleware requires a database query() method.");
  }

  return async function requireAuthenticatedUser(req, res, next) {
    const token = req.cookies?.session_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "NOT_AUTHENTICATED",
        message: "Authentication is required.",
      });
    }

    try {
      const result = await db.query(
        `SELECT u.user_id
         FROM sessions s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.session_token = $1
           AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          code: "NOT_AUTHENTICATED",
          message: "Authentication is required.",
        });
      }

      req.auth = Object.freeze({ userId: result.rows[0].user_id });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createRequireAuthenticatedUser };