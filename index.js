const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use("/api/author", require("./src/routes/author.routes"));
app.use("/api/authors", require("./src/routes/author.routes"));

app.use("/api/admin", require("./src/routes/admin.routes"));
app.use("/cart", require("./src/routes/cart.routes"));

app.use("/api/payments", require("./src/routes/payment.routes"));
// Alias without /api to support existing frontend calls
app.use("/payments", require("./src/routes/payment.routes"));
app.use("/api/revenue", require("./src/routes/revenueRoutes"));


mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("DB Connected"))
  .catch(err => console.error("DB Connection Error:", err));

app.use("/books", require("./src/routes/book.routes"));

app.listen(3000, () => console.log("Server running on 3000"));
