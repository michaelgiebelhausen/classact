import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Absence documentation (a photo of a travel letter, a clinic note)
      // reaches a server action as base64, which inflates it by ~4/3. The
      // default 1 MB body cap would reject anything over ~750 KB — far under
      // the ~6 MB the UI offers — so raise it to cover MAX_DOC_BASE64_CHARS
      // in lib/absences.ts with room for the rest of the payload.
      bodySizeLimit: "9mb",
    },
  },
};

export default nextConfig;
