import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({ serviceName: 'github-chat-app' });
}

