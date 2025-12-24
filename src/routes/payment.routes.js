const router = require("express").Router();
const express = require("express");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const payment = require("../controllers/payment.controller");

// Protected: create order and return PayHere params/hash
router.post("/checkout", auth, role(["reader"]), payment.createOrderAndHash);

// Protected: optional order status polling
router.get("/orders/:orderId", auth, role(["reader"]), payment.getOrderStatus);

// Public: PayHere notify webhook (x-www-form-urlencoded)
router.post("/notify", express.urlencoded({ extended: true }), payment.notify);

// Optional failure redirect helper
router.get("/failure", payment.getFailureRedirect);

module.exports = router;

