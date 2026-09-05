"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";

const STATE_ORDER = { active: 0, last: 1, error: 2, ready: 3 };

const STATE_STYLES = {
  active: {
    label: "In use",
    icon: "bolt",
    tone: "text-success",
    dot: "bg-success",
    background: "provider-routing-active border-success/50 bg-success/10 ring-1 ring-success/20",
  },
  error: {
    label: "Error",
    icon: "error",
    tone: "text-danger",
    dot: "bg-danger",
    background: "bg-danger/5",
  },
  last: {
    label: "Last used",
    icon: "history",
    tone: "text-warning",
    dot: "bg-warning",
    background: "bg-warning/5",
  },
  ready: {
    label: "Ready",
    icon: "check_circle",
    tone: "text-text-muted",
    dot: "bg-text-muted",
    background: "bg-bg",
  },
};

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

function normalizeProviderId(providerId) {
  if (!providerId) return "";
  return resolveProviderId(String(providerId).trim().toLowerCase()).toLowerCase();
}

function ProviderIcon({ providerId, label, color, textIcon }) {
  const imageUrl = getProviderIconSrc(providerId);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface"
      style={{ boxShadow: `inset 0 0 0 999px ${color}0A` }}
    >
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt={label}
          className="size-6 rounded-sm object-contain"
          loading="lazy"
          decoding="async"
          onError={() => {
            const match = imageUrl.match(/^\/providers\/([^/]+)\.png$/i);
            if (match) markProviderIconMissing(match[1]);
            setImgError(true);
          }}
        />
      ) : (
        <span className="text-xs font-bold" style={{ color }}>{textIcon}</span>
      )}
    </div>
  );
}

ProviderIcon.propTypes = {
  providerId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  textIcon: PropTypes.string.isRequired,
};

function ProviderListItem({ provider, state }) {
  const config = getProviderConfig(provider.provider);
  const label = (config.name !== provider.provider ? config.name : null)
    || provider.nodeName
    || provider.name
    || provider.provider;
  const stateStyle = STATE_STYLES[state];

  return (
    <div className={`relative flex min-w-0 items-center gap-3 rounded-[12px] border border-border px-3 py-2.5 transition-colors hover:border-primary/20 hover:bg-bg-hover ${stateStyle.background}`}>
      <ProviderIcon
        providerId={provider.provider}
        label={label}
        color={config.color || "#6b7280"}
        textIcon={config.textIcon || (provider.provider || "?").slice(0, 2).toUpperCase()}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-main">{label}</p>
        <p className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${stateStyle.tone}`}>
          <span className="material-symbols-outlined routing-description-icon leading-none">{stateStyle.icon}</span>
          {stateStyle.label}
        </p>
      </div>
      {state === "active" ? (
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-success" />
        </span>
      ) : (
        <span className={`size-2 shrink-0 rounded-full ${stateStyle.dot}`} />
      )}
    </div>
  );
}

ProviderListItem.propTypes = {
  provider: PropTypes.object.isRequired,
  state: PropTypes.oneOf(["active", "error", "last", "ready"]).isRequired,
};

export default function ProviderTopology({ providers = [], activeRequests = [], pending = {}, lastProvider = "", errorProvider = "" }) {
  const activeProviderCounts = useMemo(() => {
    const counts = new Map();

    for (const [modelKey, rawCount] of Object.entries(pending.byModel || {})) {
      const count = Number(rawCount) || 0;
      if (count <= 0) continue;
      const match = modelKey.match(/^(.*) \((.*)\)$/);
      const providerId = normalizeProviderId(match?.[2]);
      if (providerId) counts.set(providerId, (counts.get(providerId) || 0) + count);
    }

    for (const request of activeRequests) {
      const providerId = normalizeProviderId(request.provider);
      if (!providerId) continue;
      const count = Math.max(1, Number(request.count) || 0);
      counts.set(providerId, Math.max(counts.get(providerId) || 0, count));
    }

    return counts;
  }, [activeRequests, pending]);

  const activeSet = useMemo(() => new Set(activeProviderCounts.keys()), [activeProviderCounts]);

  const lastProviderId = normalizeProviderId(lastProvider);
  const errorProviderId = normalizeProviderId(errorProvider);
  const activeRequestCount = [...activeProviderCounts.entries()].reduce((total, [providerId, count]) => {
    return activeSet.has(providerId) ? total + count : total;
  }, 0);

  const orderedProviders = useMemo(() => (
    providers
      .map((provider, index) => {
        const normalizedId = normalizeProviderId(provider.provider);
        let state = "ready";

        if (activeSet.has(normalizedId)) state = "active";
        else if (normalizedId === errorProviderId) state = "error";
        else if (normalizedId === lastProviderId) state = "last";

        return {
          provider,
          index,
          key: provider.id || `${provider.provider}-${index}`,
          state,
        };
      })
      .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.index - right.index)
  ), [providers, activeSet, errorProviderId, lastProviderId]);
  const visibleProviders = orderedProviders.slice(0, 4);
  const providerOrderKey = visibleProviders.map((item) => item.key).join("|");
  const providerItemRefs = useRef(new Map());
  const previousPositionsRef = useRef(new Map());

  useLayoutEffect(() => {
    const nextPositions = new Map();

    for (const [key, element] of providerItemRefs.current) {
      nextPositions.set(key, element.getBoundingClientRect());
    }

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const [key, nextPosition] of nextPositions) {
        const previousPosition = previousPositionsRef.current.get(key);
        const element = providerItemRefs.current.get(key);
        const offsetY = previousPosition ? previousPosition.top - nextPosition.top : 0;

        if (element && Math.abs(offsetY) > 1) {
          element.getAnimations().forEach((animation) => animation.cancel());
          element.animate(
            [{ transform: `translateY(${offsetY}px)` }, { transform: "translateY(0)" }],
            { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        }
      }
    }

    previousPositionsRef.current = nextPositions;
  }, [providerOrderKey]);

  return (
    <Card padding="none" className="flex h-[480px] min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <span className="material-symbols-outlined usage-panel-header-icon">route</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-main">Routing activity</p>
            <p className="truncate text-xs text-text-muted">Live gateway and provider status</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full border border-border bg-bg px-2.5 py-1 text-text-muted">
            {providers.length} <span>Connected</span>
          </span>
          {activeRequestCount > 0 && (
            <span className="rounded-full bg-success/10 px-2.5 py-1 font-medium text-success">
              {activeRequestCount} <span>Active</span>
            </span>
          )}
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="material-symbols-outlined text-[30px] text-text-muted">hub</span>
          <p className="text-sm font-medium text-text-main">No providers connected</p>
          <p className="text-xs text-text-muted">Add a provider to see routing activity.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden p-4">
          <div className="grid gap-2">
            <div className={`relative flex items-center gap-3 rounded-[12px] border border-primary/25 bg-primary/5 px-3 py-3 ${activeRequestCount > 0 ? "orbit-routing-active" : ""}`}>
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <img src="/favicon.svg" alt="Orbit Router" className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-main">Orbit Router</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-primary">
                  <span className="material-symbols-outlined routing-description-icon leading-none">hub</span>
                  Central routing gateway
                </p>
              </div>
              <span className="size-2.5 shrink-0 rounded-full bg-primary" />
            </div>

            {visibleProviders.map(({ provider, key, state }) => (
              <div
                key={key}
                ref={(element) => {
                  if (element) providerItemRefs.current.set(key, element);
                  else providerItemRefs.current.delete(key);
                }}
              >
                <ProviderListItem provider={provider} state={state} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
    nodeName: PropTypes.string,
  })),
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    account: PropTypes.string,
    count: PropTypes.number,
  })),
  pending: PropTypes.shape({
    byModel: PropTypes.object,
  }),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
