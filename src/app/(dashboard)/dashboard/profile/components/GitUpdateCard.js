"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card, ConfirmModal } from "@/shared/components";
import SettingsCardHeader from "./SettingsCardHeader";

const PHASE_LABELS = {
  starting: "Starting update...",
  pulling: "Downloading update...",
  building: "Preparing update...",
  done: "Update completed successfully.",
  error: "Update failed.",
};

const STATUS_STYLES = {
  danger: {
    wrapper: "border-danger/20 bg-danger/10",
    icon: "border-danger/20 bg-danger/10 text-danger",
    title: "text-danger",
  },
  info: {
    wrapper: "border-info/20 bg-info/10",
    icon: "border-info/20 bg-info/10 text-info",
    title: "text-info",
  },
  success: {
    wrapper: "border-success/20 bg-success/10",
    icon: "border-success/20 bg-success/10 text-success",
    title: "text-success",
  },
  warning: {
    wrapper: "border-warning/20 bg-warning/10",
    icon: "border-warning/20 bg-warning/10 text-warning",
    title: "text-warning",
  },
};

function UpdateStatusNotice({ icon, title, description, tone, spin = false }) {
  const style = STATUS_STYLES[tone];

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${style.wrapper}`}>
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg border ${style.icon}`}>
        <span className={`material-symbols-outlined text-[22px] leading-none ${spin ? "animate-spin" : ""}`}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${style.title}`}>{title}</p>
        {description ? <p className="text-xs text-text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

function shortCommit(value) {
  return value ? value.slice(0, 8) : "—";
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Update request failed");
  return data;
}

export default function GitUpdateCard() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [showConfirm, setShowConfirm] = useState(false);
  const startedHereRef = useRef(false);
  const reloadScheduledRef = useRef(false);

  const loadStatus = useCallback(async (refresh, quiet = false) => {
    if (!quiet) setChecking(true);
    try {
      const response = await fetch(`/api/version/git-update?refresh=${refresh ? "1" : "0"}`, {
        cache: "no-store",
      });
      const data = await parseResponse(response);
      setStatus(data);

      if (data.operation?.status === "error") {
        setFeedback({ type: "error", message: data.operation.error || "Update failed" });
      } else if (data.operation?.status === "success") {
        setFeedback({ type: "success", message: data.operation.message || "Update completed successfully" });
        if (startedHereRef.current && !reloadScheduledRef.current) {
          reloadScheduledRef.current = true;
          setTimeout(() => globalThis.location.reload(), 1500);
        }
      } else if (!quiet) {
        if (data.updateAvailable) {
          setFeedback({
            type: data.canUpdate ? "success" : "warning",
            message: data.canUpdate
              ? `${data.behind} update commit${data.behind === 1 ? "" : "s"} available.`
              : data.blockedReason,
          });
        } else {
          setFeedback({ type: "", message: "" });
        }
      }
      return data;
    } catch (error) {
      if (!quiet) setFeedback({ type: "error", message: error.message });
      return null;
    } finally {
      if (!quiet) setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadStatus(false, true);
  }, [loadStatus]);

  const updateRunning = status?.operation?.status === "running" || status?.updateInProgress;

  useEffect(() => {
    if (!updateRunning) return undefined;
    const timer = setInterval(() => loadStatus(false, true), 2500);
    return () => clearInterval(timer);
  }, [loadStatus, updateRunning]);

  const handleUpdate = () => {
    setShowConfirm(true);
  };

  const confirmUpdate = async () => {
    setShowConfirm(false);
    setStarting(true);
    setFeedback({ type: "", message: "" });
    startedHereRef.current = true;
    try {
      const response = await fetch("/api/version/git-update", { method: "POST" });
      const data = await parseResponse(response);
      setStatus((current) => ({
        ...current,
        updateInProgress: true,
        operation: data.operation,
      }));
      setFeedback({ type: "warning", message: "Update started. Keep this page open while the service rebuilds." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      await loadStatus(false, true);
    } finally {
      setStarting(false);
    }
  };

  const operation = status?.operation;
  const phaseMessage = operation?.message
    || (operation?.phase === "restarting" ? "Restarting application..." : PHASE_LABELS[operation?.phase]);
  const isUpToDate = status?.repositoryAvailable === true
    && status?.updateAvailable === false
    && !updateRunning;
  const feedbackNotice = feedback.type === "error"
    ? { icon: "error", title: "Update failed", tone: "danger" }
    : feedback.type === "warning"
      ? { icon: "warning", title: "Update attention", tone: "warning" }
      : status?.updateAvailable
        ? { icon: "system_update_alt", title: "Update available", tone: "info" }
        : { icon: "check_circle", title: "Update completed", tone: "success" };

  return (
    <Card>
      <SettingsCardHeader
        icon="system_update_alt"
        title="Application Update"
        subtitle="Check for new versions and keep Orbit Router up to date."
        tone="purple"
        className="mb-4"
      />

      <div className="flex flex-col gap-3">
        {status?.repositoryAvailable && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-bg p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2">
                  <span className="material-symbols-outlined text-[20px] leading-none text-text-muted">sync_saved_locally</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-text-muted">Current branch</p>
                  <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
                    <p className="truncate text-sm font-medium">{status.branch}</p>
                    <code className="shrink-0 text-xs text-text-muted">({shortCommit(status.currentCommit)})</code>
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2">
                  <span className="material-symbols-outlined text-[20px] leading-none text-text-muted">cloud</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-text-muted">Remote branch</p>
                  <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
                    <p className="truncate text-sm font-medium">{status.upstream}</p>
                    <code className="shrink-0 text-xs text-text-muted">({shortCommit(status.remoteCommit)})</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isUpToDate && (
          <UpdateStatusNotice
            icon="check_circle"
            title="Orbit Router is up to date"
            description="You are running the latest available version."
            tone="success"
          />
        )}

        {updateRunning && (
          <UpdateStatusNotice
            icon="progress_activity"
            title={phaseMessage || "Update in progress..."}
            description="The dashboard may disconnect briefly during the PM2 restart."
            tone="info"
            spin
          />
        )}

        {feedback.message && !updateRunning && !isUpToDate && (
          <UpdateStatusNotice
            icon={feedbackNotice.icon}
            title={feedbackNotice.title}
            description={feedback.message}
            tone={feedbackNotice.tone}
          />
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="secondary"
            icon="refresh"
            loading={checking}
            disabled={starting || updateRunning}
            onClick={() => loadStatus(true)}
            className="w-full"
          >
            Check for updates
          </Button>
          {status?.updateAvailable && (
            <Button
              variant="success"
              icon="system_update_alt"
              loading={starting}
              disabled={!status.canUpdate || updateRunning || checking}
              onClick={handleUpdate}
              className="w-full"
            >
              Update now
            </Button>
          )}
        </div>

      </div>
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={confirmUpdate}
        title="Update 9Router"
        message="Update 9Router now? The dashboard may be unavailable briefly while the update is installed."
        confirmText="Update now"
        cancelText="Cancel"
        variant="primary"
      />
    </Card>
  );
}
