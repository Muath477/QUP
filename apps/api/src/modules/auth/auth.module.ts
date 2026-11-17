import { Module } from "@nestjs/common";

import { EmailModule } from "../email/email.module.js";
import { AdminBootstrapService } from "./application/admin-bootstrap.service.js";
import { AuthService } from "./application/auth.service.js";
import { OtpService } from "./application/otp.service.js";
import { USER_DIRECTORY } from "./auth.contract.js";
import { AUTH_STORE, CLOCK, type Clock, OTP_STORE, PASSWORD_HASHER } from "./domain/ports.js";
import { Argon2PasswordHasher } from "./infrastructure/argon2-password-hasher.js";
import { DrizzleAuthStore } from "./infrastructure/drizzle-auth-store.js";
import { DrizzleOtpStore } from "./infrastructure/drizzle-otp-store.js";
import { DrizzleUserDirectory } from "./infrastructure/drizzle-user-directory.js";
import { AuthController } from "./presentation/auth.controller.js";

const systemClock: Clock = { now: () => new Date() };

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    AdminBootstrapService,
    { provide: AUTH_STORE, useClass: DrizzleAuthStore },
    { provide: OTP_STORE, useClass: DrizzleOtpStore },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: CLOCK, useValue: systemClock },
    { provide: USER_DIRECTORY, useClass: DrizzleUserDirectory },
  ],
  exports: [AuthService, AdminBootstrapService, USER_DIRECTORY],
})
export class AuthModule {}
