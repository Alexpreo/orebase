import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rise flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <span className="text-[13px] text-fg-3">{eyebrow}</span> : null}
        <h1 className="font-heading text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">
          {title}
        </h1>
        {subtitle ? <p className="text-sm text-fg-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2.5">{actions}</div> : null}
    </header>
  );
}
