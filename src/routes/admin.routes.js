const router = require("express").Router();
const adminController = require("../controllers/admin.controller");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

// All routes require authentication and 'admin' role
router.use(auth, role(["admin"]));

router.get("/dashboard-stats", adminController.getDashboardStats);
router.get("/users", adminController.getAllUsers);
router.delete("/users/:id", adminController.deleteUser);
router.get("/books", adminController.getAllBooks);
router.delete("/books/:id", adminController.deleteBook);
router.get("/audit-logs", adminController.getAuditLogs);

module.exports = router;
