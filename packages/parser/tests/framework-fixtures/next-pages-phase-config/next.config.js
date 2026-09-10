const constants = require("next/constants");

module.exports = (phase) => ({ reactStrictMode: phase === constants.PHASE_DEVELOPMENT_SERVER });
