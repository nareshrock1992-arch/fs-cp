module.exports = {
  apps: [
    {
      name: "fs-backend",
      script: "server.js",
      cwd: "/opt/freeswitch-ui/fs-cc/backend",
      watch: false,
      env: {
        NODE_ENV: "development",
        PORT: 4000
      }
    },
    {
      name: "fs-frontend",
      cwd: "/opt/freeswitch-ui/fs-cc/frontend",
      script: "npm",
      args: "run dev -- --host 0.0.0.0 --port 8000",
      watch: false,
      env: {
        NODE_ENV: "development"
      }
    },
    {
      name: "fs-agent",
      cwd: "/opt/freeswitch-ui/fs-cc/agent-desktop",
      script: "npm",
      args: "run dev -- --host 0.0.0.0 --port 8080",
      watch: false,
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};
