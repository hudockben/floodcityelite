/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // exceljs (used for parsing bulk-roster .xlsx uploads) relies on Node built-ins
  // and dynamic requires; keep it out of the bundler so it's required at runtime.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
