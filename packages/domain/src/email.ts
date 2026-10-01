/** Email handling shared by registration, invitations and engagement contacts. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,20}$/;

/** Syntactic plausibility only; ownership is proven by delivery (verification links). */
export const isPlausibleEmail = (email: string): boolean => EMAIL.test(email);
