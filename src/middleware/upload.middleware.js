const multer = require("multer");
const path = require("path");
const fs = require("fs");

["uploads/covers", "uploads/manuscripts"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "coverImage") cb(null, "uploads/covers");
    else if (file.fieldname === "manuscript") cb(null, "uploads/manuscripts");
    else cb(null, "uploads/others");
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

module.exports = upload;
