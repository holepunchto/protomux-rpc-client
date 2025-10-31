exports.retry = async (fn, options = {}) => {};

exports.circuitBreaker = (fn, options) => {};

exports.rateLimiter = (fn, options = {}, ...args) => {};

exports.timeLimiter = async (fn, options = {}) => {};

exports.bulkHead = async (fn, options = {}) => {};
