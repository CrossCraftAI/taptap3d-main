import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone, because the deployment target is a container rather than a
  // platform that understands Next. It is set here rather than discovered at
  // deploy time so the Dockerfile and the local build agree.
  output: "standalone",
  typedRoutes: true,
};

export default config;
