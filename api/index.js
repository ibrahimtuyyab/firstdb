// Vercel serverless entry point. All /api/* traffic is rewritten here by
// vercel.json and handed to the Express app, which keeps its own routing.
module.exports = require('../server.js');
