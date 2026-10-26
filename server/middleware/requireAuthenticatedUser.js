function createRequireAuthenticatedUser({ db, allowDeletionStatus = false }) {
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
        `SELECT u.user_id, u.deletion_status
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

      const deletionStatus = result.rows[0].deletion_status || "active";
      if (!allowDeletionStatus && deletionStatus !== "active") {
        return res.status(423).json({
          success: false,
          code: "ACCOUNT_DELETION_PENDING",
          message: "This account is being deleted. Only deletion status, retry, and logout are available.",
        });
      }

      req.auth = Object.freeze({ userId: result.rows[0].user_id, deletionStatus });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createRequireAuthenticatedUser };