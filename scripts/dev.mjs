#!/usr/bin/env node
// Запускает API (порт 8080) и Vite (порт 5173) одновременно.
import { spawn } from 'node:child_process';
const run = (args) => spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run(['run', 'build', '-w', '@zayush/shared']), null];
procs[0].on('exit', () => {
  const bot = spawn('npm', ['run', 'build', '-w', '@zayush/bot'], { stdio: 'inherit', shell: process.platform === 'win32' });
  bot.on('exit', () => {
    const api = run(['run', 'dev', '-w', '@zayush/api']);
    const web = run(['run', 'dev', '-w', '@zayush/web']);
    const stop = () => { api.kill(); web.kill(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
});
