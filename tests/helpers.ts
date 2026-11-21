export const OWNER_URL = process.env.TEST_DATABASE_URL_OWNER;
export const APP_URL = process.env.TEST_DATABASE_URL_APP;
export const HAS_DB = !!(OWNER_URL && APP_URL);
