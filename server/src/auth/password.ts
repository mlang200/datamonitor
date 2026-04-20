import argon2 from 'argon2';

export interface PasswordService {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  validate(password: string): { valid: boolean; error?: string };
}

const MIN_PASSWORD_LENGTH = 8;

export function createPasswordService(): PasswordService {
  return {
    async hash(password: string): Promise<string> {
      return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });
    },

    async verify(hash: string, password: string): Promise<boolean> {
      return argon2.verify(hash, password);
    },

    validate(password: string): { valid: boolean; error?: string } {
      if (password.length < MIN_PASSWORD_LENGTH) {
        return {
          valid: false,
          error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`,
        };
      }
      return { valid: true };
    },
  };
}
