"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Card from "@/shared/components/Card";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getCurrentLocale, onLocaleChange, translate } from "@/i18n/runtime";
import dynamic from "next/dynamic";
const UsageChart = dynamic(() => import("./usage/components/UsageChart"), { ssr: false, loading: () => null });

const quickLinks = [
  { href: "/dashboard/endpoint", label: "Configure endpoint", icon: "key" },
  { href: "/dashboard/providers", label: "Manage providers", icon: "dns" },
  { href: "/dashboard/usage", label: "View detailed usage", icon: "bar_chart" },
  { href: "/dashboard/combos", label: "Configure combos", icon: "merge_type" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "code" },
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "android_wifi_4_bar_lock" },
];

function getEffectiveStatus(connection) {
  const hasActiveCooldown = Object.entries(connection).some(
    ([key, value]) =>
      key.startsWith("modelLock_") && value && new Date(value).getTime() > Date.now(),
  );

  return connection.testStatus === "unavailable" && !hasActiveCooldown
    ? "active"
    : connection.testStatus;
}

function formatRelativeTime(timestamp, formatter) {
  if (!timestamp) return formatter.format(0, "second");
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 60) return formatter.format(0, "second");
  if (elapsedSeconds < 3600) return formatter.format(-Math.floor(elapsedSeconds / 60), "minute");
  if (elapsedSeconds < 86400) return formatter.format(-Math.floor(elapsedSeconds / 3600), "hour");
  return formatter.format(-Math.floor(elapsedSeconds / 86400), "day");
}

function MetricCard({ label, value, detail, icon, tone = "text-text-main", loading }) {
  return (
    <Card className="flex min-w-0 items-start justify-between gap-3" padding="sm">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        {loading ? (
          <div className="mt-2 h-8 w-20 animate-pulse rounded bg-bg-subtle" />
        ) : (
          <p className={`mt-1 truncate text-2xl font-bold ${tone}`}>{value}</p>
        )}
        <p className="mt-1 truncate text-xs text-text-muted">{detail}</p>
      </div>
      <span className="material-symbols-outlined rounded-[10px] bg-bg p-2 text-[20px] text-text-muted">
        {icon}
      </span>
    </Card>
  );
}

export default function HomePageClient() {
  const [usage, setUsage] = useState(null);
  const [connections, setConnections] = useState(null);
  const [models, setModels] = useState(null);
  const [failedSources, setFailedSources] = useState([]);
  const [cachedModelsCount] = useState(() => {
    try {
      const v = typeof window !== "undefined" ? window.localStorage.getItem("homeModelsCount") : null;
      if (v) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [locale, setLocale] = useState(() => getCurrentLocale());

  useEffect(() => onLocaleChange(() => setLocale(getCurrentLocale())), []);

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact" }),
    [locale],
  );
  const relativeTimeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    [locale],
  );

  useEffect(() => {
    let cancelled = false;

    const fetchWithTimeout = async (url, timeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      } finally {
        clearTimeout(timer);
      }
    };

    const loadEssential = async () => {
      const sources = [
        ["usage statistics", "/api/usage/stats?period=today", 4000],
        ["providers", "/api/providers", 4000],
      ];
      const results = await Promise.allSettled(
        sources.map(async ([label, url, timeout]) => fetchWithTimeout(url, timeout)),
      );

      if (cancelled) return;

      const failures = [];
      if (results[0].status === "fulfilled") setUsage(results[0].value);
      else failures.push(sources[0][0]);
      if (results[1].status === "fulfilled") setConnections(results[1].value.connections || []);
      else failures.push(sources[1][0]);

      if (failures.length) setFailedSources((prev) => [...prev, ...failures]);
      setLoading(false);
    };

    const loadModels = async () => {
      // Single full catalog fetch: the fast endpoint returns a smaller static
      // list, so showing it first makes the counter flicker (e.g. 40 -> 120).
      // Keep the skeleton visible until the final count arrives instead.
      try {
        const data = await fetchWithTimeout("/api/models/catalog", 8000);
        if (cancelled) return;
        const filtered = (data.data || []).filter((model) => !model.disabled);
        setModels(filtered);
        try { window.localStorage.setItem("homeModelsCount", String(filtered.length)); } catch {}
      } catch {
        if (cancelled) return;
        setModels([]);
        setFailedSources((prev) => (prev.includes("models") ? prev : [...prev, "models"]));
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    };

    loadEssential();
    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const eventSource = new EventSource("/api/usage/stream");

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setUsage((current) => current ? {
          ...current,
          activeRequests: data.activeRequests,
          recentRequests: data.recentRequests,
          errorProvider: data.errorProvider,
          pending: data.pending,
        } : current);
      } catch (error) {
        console.error("[HOME USAGE SSE] parse error:", error);
      }
    };

    return () => eventSource.close();
  }, []);

  const providerStats = useMemo(() => {
    const allConnections = connections || [];
    const enabled = allConnections.filter((connection) => connection.isActive !== false);
    const healthy = enabled.filter((connection) => {
      const status = getEffectiveStatus(connection);
      return status === "active" || status === "success";
    });
    const providerIds = new Set(allConnections.map((connection) => connection.provider).filter(Boolean));
    const groups = Array.from(providerIds).map((provider) => {
      const providerConnections = enabled.filter((connection) => connection.provider === provider);
      const healthyCount = providerConnections.filter((connection) => {
        const status = getEffectiveStatus(connection);
        return status === "active" || status === "success";
      }).length;
      return {
        provider,
        enabled: providerConnections.length,
        healthy: healthyCount,
      };
    });

    return {
      providers: providerIds.size,
      enabledAccounts: enabled.length,
      healthyAccounts: healthy.length,
      healthyProviders: groups.filter((group) => group.healthy > 0).length,
      attentionProviders: groups.filter((group) => group.enabled > 0 && group.healthy === 0).length,
      disabledProviders: groups.filter((group) => group.enabled === 0).length,
    };
  }, [connections]);

  const estimatedModelsCount = useMemo(() => {
    // Only used if the catalog request fails; never show a guessed number
    // while loading, otherwise the counter flickers.
    if (models !== null) return null;
    if (!connections) return null;
    let count = 0;
    for (const conn of connections.filter((c) => c.isActive !== false)) {
      const pid = conn.provider;
      const staticModels = PROVIDER_MODELS[pid] || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[pid]] || [];
      const enabled = conn.providerSpecificData?.enabledModels;
      if (Array.isArray(enabled) && enabled.length > 0) count += enabled.filter((id) => typeof id === "string" && id.trim() !== "").length;
      else count += staticModels.length;
    }
    return count;
  }, [connections, models]);

  const displayModelsCount = models !== null ? models.length : (modelsLoading ? null : (estimatedModelsCount ?? cachedModelsCount ?? 0));
  const displayModelsLoading = modelsLoading;

  const allEnabledAccountsHealthy = providerStats.healthyAccounts === providerStats.enabledAccounts;
  const allEnabledAccountsUnhealthy = providerStats.healthyAccounts === 0;
  const providerHealthIndicator = allEnabledAccountsHealthy
    ? { icon: "check_circle", color: "text-success" }
    : allEnabledAccountsUnhealthy
      ? { icon: "cancel", color: "text-danger" }
      : { icon: "warning", color: "text-warning" };

  const activeRequests = (usage?.activeRequests || []).reduce(
    (total, request) => total + Number(request.count || 0),
    0,
  );
  const tokensToday = (usage?.totalPromptTokens || 0) + (usage?.totalCompletionTokens || 0);
  const recentRequests = (usage?.recentRequests || []).slice(0, 6);

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6 overflow-x-hidden px-1 sm:px-0">
      {failedSources.length > 0 && (
        <div className="flex items-start gap-3 rounded-[12px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-text-main">
          <span className="material-symbols-outlined text-[20px] text-warning">warning</span>
          <p>
            {translate("Could not load")} {failedSources.map(translate).join(", ")}. {translate("The remaining information is still available.")}
          </p>
        </div>
      )}

      <section aria-label={translate("Gateway overview")} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <MetricCard label={translate("Providers")} value={providerStats.providers} detail={translate("Connected")} icon="dns" tone="text-orange-500" loading={loading && connections === null} />
        <MetricCard label={translate("Models")} value={displayModelsCount === null ? "" : numberFormatter.format(displayModelsCount)} detail={translate("Available")} icon="deployed_code" tone="text-cyan-400" loading={displayModelsLoading} />
        <MetricCard label={translate("Requests")} value={numberFormatter.format(usage?.totalRequests || 0)} detail={translate("Today")} icon="send" tone="text-primary" loading={loading && usage === null} />
        <MetricCard label={translate("Tokens")} value={numberFormatter.format(tokensToday)} detail={translate("Used today")} icon="token" tone="text-info" loading={loading && usage === null} />
        <MetricCard label={translate("In progress")} value={numberFormatter.format(activeRequests)} detail={translate("Active requests")} icon="design_services" tone="text-success" loading={loading && usage === null} />
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-w-0">
          <UsageChart period="7d" />
        </div>
        <Card title={translate("Provider health")} subtitle={translate("Enabled account status")} icon="health_and_safety" padding="sm" className="flex h-full flex-col">
          {loading && connections === null ? (
            <div className="flex flex-1 flex-col gap-3">
              {[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded bg-bg-subtle" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-[10px] border border-border-subtle bg-bg p-4">
                <div className="flex items-center gap-4">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-[12px] border border-border bg-surface-2">
                    <span className={`material-symbols-outlined text-[32px] ${providerHealthIndicator.color}`}>
                      {providerHealthIndicator.icon}
                    </span>
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${providerHealthIndicator.color}`}>{providerStats.healthyAccounts} / {providerStats.enabledAccounts}</p>
                    <p className="text-xs text-text-muted">{translate("enabled accounts healthy")}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[10px] bg-success/10 p-3">
                  <p className="font-bold text-success">{providerStats.healthyProviders}</p>
                  <p className="text-[11px] text-text-muted">{translate("Healthy")}</p>
                </div>
                <div className="rounded-[10px] bg-warning/10 p-3">
                  <p className="font-bold text-warning">{providerStats.attentionProviders}</p>
                  <p className="text-[11px] text-text-muted">{translate("Attention")}</p>
                </div>
                <div className="rounded-[10px] bg-danger/10 p-3">
                  <p className="font-bold text-danger">{providerStats.disabledProviders}</p>
                  <p className="text-[11px] text-danger">{translate("Disabled")}</p>
                </div>
              </div>
              <Link
                href="/dashboard/providers"
                className="group mt-auto flex w-full items-center justify-center gap-2 rounded-[10px] border border-border-subtle bg-bg px-3 py-2.5 text-center text-sm font-medium text-text-main transition-colors hover:border-primary/30 hover:bg-bg-hover"
              >
                {translate("View all providers")}
                <span className="material-symbols-outlined text-[18px] text-text-muted transition-colors group-hover:text-primary">arrow_forward</span>
              </Link>
            </div>
          )}
        </Card>
      </section>

      <section className="grid w-full max-w-full min-w-0 grid-cols-1 gap-6 overflow-hidden xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          title={translate("Recent requests")}
          subtitle={translate("Latest processed calls")}
          icon="history"
          iconClassName="text-[21px]"
          iconContainerClassName="bg-info/10 text-info"
          padding="sm"
          className="w-full max-w-full min-w-0 overflow-hidden"
        >
          {loading && usage === null ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse rounded bg-bg-subtle" />)}
            </div>
          ) : recentRequests.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">
              {translate("Requests will appear here after the first gateway call.")}
            </div>
          ) : (
            <div className="divide-y divide-border-subtle overflow-hidden">
              {recentRequests.map((request, index) => (
                <div key={`${request.timestamp}-${request.provider}-${request.model}-${index}`} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 shrink-0 items-center justify-center">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${request.status === "error" ? "bg-danger" : "bg-success"}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-main">{request.model || translate("Model not provided")}</p>
                    <p className="truncate text-xs text-text-muted">{request.provider || translate("Provider not provided")}</p>
                  </div>
                  <div className="min-w-0 shrink-0 text-right">
                    <p className="whitespace-nowrap text-xs font-medium text-text-main">{numberFormatter.format((request.promptTokens || 0) + (request.completionTokens || 0))} {translate("tokens")}</p>
                    <p className="whitespace-nowrap text-[11px] text-text-muted">{formatRelativeTime(request.timestamp, relativeTimeFormatter)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={translate("Quick access")}
          subtitle={translate("Configuration shortcuts")}
          icon="bolt"
          iconClassName="text-[21px]"
          iconContainerClassName="bg-warning/10 text-warning"
          padding="sm"
          className="w-full max-w-full min-w-0 overflow-hidden"
        >
          <nav aria-label={translate("Dashboard shortcuts")} className="flex min-w-0 flex-col gap-2">
            {quickLinks.map((item) => (
              <Link key={item.href} href={item.href} className="group flex min-w-0 items-center gap-3 rounded-[10px] border border-border-subtle bg-bg px-3 py-3 transition-colors hover:border-primary/30 hover:bg-bg-hover">
                <span className="material-symbols-outlined shrink-0 text-[20px] text-text-muted group-hover:text-primary">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-main">{translate(item.label)}</span>
                <span className="material-symbols-outlined shrink-0 text-[16px] text-text-muted">chevron_right</span>
              </Link>
            ))}
          </nav>
        </Card>
      </section>
    </div>
  );
}


