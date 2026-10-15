import { z } from 'zod';

export const UsernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{1,15}$/, 'Use 1–15 letters, numbers or underscores');
