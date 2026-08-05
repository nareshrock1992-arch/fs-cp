// Express 4 does not forward rejected promises from async handlers to
// next(err) automatically. Wrap every controller with this so a thrown/
// rejected error (e.g. a dead DB pool or ESL timeout) becomes a clean
// JSON 500 instead of a hung request.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
