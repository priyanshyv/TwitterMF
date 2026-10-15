import { z } from 'zod';
import { UsernameSchema } from '../users/user.schemas.js';

// Names that would collide with app routes (/users/suggestions, /login, ...).
const RESERVED = new Set([
  'admin',
  'api',
  'home',
  'login',
  'logout',
  'settings',
  'signup',
  'status',
  'suggestions',
  'timeline',
]);

export const SignupSchema = z.object({
  username: UsernameSchema.refine(
    (u) => !RESERVED.has(u.toLowerCase()),
    'That username is reserved',
  ),
  displayName: z.string().trim().min(1, 'Enter a name').max(50),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128, 'Use at most 128 characters'),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  username: z.string().trim().min(1).max(15),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;
