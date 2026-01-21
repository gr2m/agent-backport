import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workflow DevKit requires this for proper directive handling
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default withWorkflow(nextConfig);
