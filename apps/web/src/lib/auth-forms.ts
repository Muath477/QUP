import { z } from "zod";

/**
 * Form schemas for sign-in and sign-up. They exist to help the student fix
 * mistakes before a round trip; the API validates everything again and is the
 * only authority (AGENTS.md §9: no business rules duplicated in the UI). The
 * limits mirror the API's so the two never disagree about a valid password.
 */

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const MAX_NAME_LENGTH = 80;

/** Blank optional inputs are "not provided", not empty strings to validate. */
const blankToUndefined = (value: string) => (value.trim() === "" ? undefined : value.trim());

export const loginForm = z.object({
  identifier: z.string().trim().min(1, "اكتب بريدك أو رقم جوالك"),
  password: z.string().min(1, "اكتب كلمة المرور"),
});
export type LoginForm = z.infer<typeof loginForm>;

export const registerForm = z
  .object({
    displayName: z.string().max(MAX_NAME_LENGTH, "الاسم طويل جدًا").transform(blankToUndefined),
    email: z
      .string()
      .transform(blankToUndefined)
      .pipe(z.email("بريد إلكتروني غير صحيح").optional()),
    phone: z
      .string()
      .transform(blankToUndefined)
      .pipe(
        z
          .string()
          .regex(/^\+[1-9]\d{7,14}$/, "اكتب الرقم بالصيغة الدولية، مثل ‎+9665XXXXXXXX")
          .optional(),
      ),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `كلمة المرور ${PASSWORD_MIN_LENGTH} حرفًا على الأقل`)
      .max(PASSWORD_MAX_LENGTH, "كلمة المرور طويلة جدًا"),
  })
  .refine((form) => form.email !== undefined || form.phone !== undefined, {
    message: "اكتب بريدك الإلكتروني أو رقم جوالك (أو كليهما)",
    path: ["email"],
  });
export type RegisterFormInput = z.input<typeof registerForm>;
export type RegisterForm = z.output<typeof registerForm>;

export const profileForm = z.object({
  displayName: z.string().trim().max(MAX_NAME_LENGTH, "الاسم طويل جدًا"),
});
export type ProfileForm = z.infer<typeof profileForm>;

export const passwordForm = z
  .object({
    currentPassword: z.string().min(1, "اكتب كلمة المرور الحالية"),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `كلمة المرور ${PASSWORD_MIN_LENGTH} حرفًا على الأقل`)
      .max(PASSWORD_MAX_LENGTH, "كلمة المرور طويلة جدًا"),
    confirmPassword: z.string(),
  })
  .refine((form) => form.newPassword === form.confirmPassword, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirmPassword"],
  })
  .refine((form) => form.newPassword !== form.currentPassword, {
    message: "اختر كلمة مرور مختلفة عن الحالية",
    path: ["newPassword"],
  });
export type PasswordForm = z.infer<typeof passwordForm>;
