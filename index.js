const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

mongoose.connect("mongodb://localhost:27017/eBook")
  .then(() => console.log("DB Connected"))
  .catch(err => console.error("DB Connection Error:", err));

app.listen(3000, () => console.log("Server running on 3000"));
