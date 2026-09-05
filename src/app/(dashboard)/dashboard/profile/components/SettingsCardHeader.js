import { cn } from "@/shared/utils/cn";

const ICON_TONES = {
  blue: "text-blue-500",
  green: "text-green-500",
  orange: "text-orange-500",
  primary: "text-primary",
  purple: "text-purple-500",
};

export default function SettingsCardHeader({ icon, title, subtitle, tone = "primary", className }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-bg">
        <span className={cn("material-symbols-outlined select-none text-[22px] leading-none", ICON_TONES[tone])}>
          {icon}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-text-main sm:text-lg">{title}</h3>
        {subtitle ? <p className="text-xs text-text-muted sm:text-sm">{subtitle}</p> : null}
      </div>
    </div>
  );
}
