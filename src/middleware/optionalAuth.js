const jwt = require("jsonwebtoken");
const config = require("../config/config");

module.exports = function (req, res, next) {
  const token = req.header("Authorization");
  if (!token) return next();

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), config.JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    return res.status(401).json({ msg: "Invalid token" });
  }

  return next();
};

