const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect("mongodb://localhost:27017/eBook")
  .then(() => console.log("DB Connected"))
  .catch(err => console.error("DB Connection Error:", err));

app.use("/books", require("./src/routes/book.routes"));

app.listen(3000, () => console.log("Server running on 3000"));
