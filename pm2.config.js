module.exports = {
  apps: [
    {
      name: 'app',
      script: 'yarn',
      args: 'start',
      interpreter: 'bash',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
