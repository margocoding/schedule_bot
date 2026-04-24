const parseAdminIds = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));

export const config = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || "",
  MONGODB_URI: process.env.MONGODB_URI || "",
  REDIS_URL: process.env.REDIS_URL || "",
  ADMIN_TELEGRAM_IDS: parseAdminIds(process.env.ADMIN_TELEGRAM_IDS || ""),
  SUPPORT_URL: process.env.SUPPORT_URL || "",
  PORTFOLIO_URL: process.env.PORTFOLIO_URL || "",
  CONTACT_PHONE: process.env.CONTACT_PHONE || "",
  ADDRESS: process.env.ADDRESS || "",
};

export const assertConfig = () => {
  const missing = Object.entries({
    TELEGRAM_TOKEN: config.TELEGRAM_TOKEN,
    MONGODB_URI: config.MONGODB_URI,
    REDIS_URL: config.REDIS_URL,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
};
