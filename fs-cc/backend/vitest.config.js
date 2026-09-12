// Test-only configuration. BUSINESS_TIMEZONE is REQUIRED by the application at
// runtime (validated at startup, no default). Here we pin it to Asia/Kolkata so
// controller/report unit tests have a deterministic business day to assert
// against. This is NOT an application default — production supplies the value via
// deployment (fs-cp). Helper tests (timezone.test.js) pass explicit zones and do
// not depend on this. Exported as a plain object to avoid importing 'vitest/config'.
export default {
  test: {
    env: {
      BUSINESS_TIMEZONE: 'Asia/Kolkata',
    },
  },
};
