// pm2 process definition for lifeOS — the Linux/cloud equivalent of `pm2 start lifeOS` on Windows.
// NOTE: must be .cjs (not .js) because package.json sets "type": "module", which would otherwise
// treat this CommonJS file as an ES module and break `module.exports`.
//
//   pm2 start ecosystem.config.cjs  # launch
//   pm2 save                        # remember it across reboots
//   pm2 startup                     # print the systemd hook; run that line, then `pm2 save` again
//
// PATH note: pm2's systemd boot environment is minimal, so the `claude` CLI (and tailscale, used by
// the Calendar MCP) may not be on PATH. We prepend the usual global-npm bin dirs here. If `claude`
// still isn't found at runtime, set an ABSOLUTE "claudePath" in config.json (output of `which claude`).
module.exports = {
  apps: [
    {
      name: 'lifeOS',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '600M',
      // SSE streams + a long-lived `claude` child must not be killed for "no output" — disable the
      // watchdog and let pm2 only restart on actual crash.
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '7777',
        HOST: '0.0.0.0', // bound to all interfaces, but only reachable over Tailscale (no public port)
        PATH: [
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          '/usr/local/sbin',
          '/usr/sbin',
          `${process.env.HOME || '/home/ubuntu'}/.npm-global/bin`,
          process.env.PATH || '',
        ].join(':'),
      },
      out_file: `${process.env.HOME || '.'}/.pm2/logs/lifeOS-out.log`,
      error_file: `${process.env.HOME || '.'}/.pm2/logs/lifeOS-error.log`,
      time: true,
    },
  ],
};
