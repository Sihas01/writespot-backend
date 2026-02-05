const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  createReport,
  getReports,
  updateReportStatus,
  resolveReport,
  getAuthorReportSummary,
  getAuthorReports,
  suspendAuthorFromReports,
  deleteAuthorFromReports,
  activateAuthorFromReports,
  getBookReportSummary,
  getBookReports,
  removeBookFromReports,
} = require("../controllers/report.controller");

// Create a new report (authenticated users)
router.post("/", auth, createReport);

// Get all reports (admin only)
router.get("/", auth, roleMiddleware(["admin"]), getReports);

// Author report management (admin only)
router.get("/admin/authors", auth, roleMiddleware(["admin"]), getAuthorReportSummary);
router.get("/admin/authors/:authorId", auth, roleMiddleware(["admin"]), getAuthorReports);
router.patch("/admin/authors/:authorId/suspend", auth, roleMiddleware(["admin"]), suspendAuthorFromReports);
router.patch("/admin/authors/:authorId/delete", auth, roleMiddleware(["admin"]), deleteAuthorFromReports);
router.patch("/admin/authors/:authorId/activate", auth, roleMiddleware(["admin"]), activateAuthorFromReports);

// Book report management (admin only)
router.get("/admin/books", auth, roleMiddleware(["admin"]), getBookReportSummary);
router.get("/admin/books/:bookId", auth, roleMiddleware(["admin"]), getBookReports);
router.post("/admin/books/:bookId/remove", auth, roleMiddleware(["admin"]), removeBookFromReports);

// Update report status (admin only)
router.patch("/:reportId/status", auth, roleMiddleware(["admin"]), updateReportStatus);

// Resolve report with moderation action (admin only)
router.patch("/:reportId/resolve", auth, roleMiddleware(["admin"]), resolveReport);

module.exports = router;
