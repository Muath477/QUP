"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/session";
import { Icon } from "./icon";

/**
 * A quiet reminder, on the student's own pages, to verify the email address.
 * Shown only when it can be acted on: the account has an email that is not
 * verified yet, and this deployment can actually mail a code. It blocks
 * nothing (OPEN_QUESTIONS.md #6): it protects the account's recovery.
 */
export function EmailVerifyBanner() {
  const path = usePathname();
  const { data: me } = useMe();
  if (!me?.user.email || me.user.emailVerified || !me.features?.emailCodes) return null;
  if (path === "/verify-email") return null;
  return (
    <div className="email-banner" role="status">
      <Icon name="shield" />
      <p>وثّق بريدك الإلكتروني لتتمكن من استعادة حسابك إذا نسيت كلمة المرور.</p>
      <Link href="/verify-email" className="btn btn--ghost btn--small">
        وثّقه الآن
      </Link>
    </div>
  );
}
