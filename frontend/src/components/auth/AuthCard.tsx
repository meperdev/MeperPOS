"use client";

import Link from "next/link";
import Image from "next/image";
import { APP_NAME } from "@/lib/constants";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: { text: string; linkText: string; href: string };
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 md:p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl p-8 md:p-10 bg-card border border-border/80 space-y-6">
          {/* Logo & Header */}
          <div className="text-center space-y-2">
            <Image
              src="/brand/lockup-horizontal-light.png"
              alt={`${APP_NAME} logo`}
              width={1200}
              height={300}
              className="mx-auto mb-4 block h-10 w-auto dark:hidden"
            />
            <Image
              src="/brand/lockup-horizontal-dark.png"
              alt={`${APP_NAME} logo`}
              width={1200}
              height={300}
              className="mx-auto mb-4 hidden h-10 w-auto dark:block"
            />
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>

          {/* Content / Form */}
          <div>{children}</div>

          {/* Footer */}
          {footer && (
            <p className="text-center pt-4 border-t border-border/60 text-[13px] text-muted-foreground">
              {footer.text}{" "}
              <Link
                href={footer.href}
                className="font-bold text-primary-text hover:text-primary-dark transition-colors ml-1"
              >
                {footer.linkText}
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
