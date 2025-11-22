// TEMPORARY 

module.exports = (req, res, next) => {
    req.user = {
        id: "123456789",
        role: "author" // change to: "admin" | "author" | "reader"
    };
    next();
};
